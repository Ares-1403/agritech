import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import json
import os
from datetime import datetime
import math

# --- CONFIGURACION ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_NAME = os.path.join(BASE_DIR, "database.db")
STATIC_DIR = os.path.join(BASE_DIR, 'static')
MODEL_PATH = os.path.join(BASE_DIR, "best.pt")

app = FastAPI(title="Chuuk AgriTech API v3.0")

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONEXION BD ---
def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

# --- LOGICA AGRONOMICA (FOG COMPUTING) ---
def calcular_dpv(temperatura, humedad_relativa):
    """
    Calcula el Deficit de Presion de Vapor (DPV) usando la formula de Tetens.
    Retorna el valor en kPa.
    """
    if humedad_relativa is None or temperatura is None:
        return 0.0
    
    # 1. Presion de Vapor de Saturacion (SVP)
    svp = 0.61078 * math.exp((17.27 * temperatura) / (temperatura + 237.3))
    
    # 2. Deficit de Presion de Vapor (DPV)
    dpv = svp * (1 - (humedad_relativa / 100))
    return round(dpv, 2)

def determinar_estres(temp, dpv, uv):
    """
    Determina si la planta esta en estres abiotico basado en umbrales ecofisiologicos.
    """
    # Umbrales definidos en la investigacion
    if temp > 35 or dpv > 2.0 or uv > 9:
        return True
    return False

# --- ENDPOINTS ---

@app.get("/api/farm_map")
async def get_farm_map():
    try:
        conn = get_db_connection()
        plants = conn.execute('SELECT * FROM Parcelas').fetchall()
        conn.close()
        return [dict(row) for row in plants]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en BD: {e}")

@app.get("/api/plant_data/{plant_id}")
async def get_plant_data(plant_id: str):
    """
    Endpoint inteligente que recupera datos brutos y procesa metricas derivadas (DPV, Estres)
    antes de enviarlas al frontend.
    """
    conn = get_db_connection()
    
    # 1. Info basica de la planta
    plant_info = conn.execute('SELECT * FROM Parcelas WHERE id_planta = ?', (plant_id,)).fetchone()
    
    if not plant_info:
        conn.close()
        raise HTTPException(status_code=404, detail="Planta no encontrada")
    
    # 2. Lecturas de Sensores (Crudas)
    # Seleccion explicita de columnas incluyendo radiacion_solar para asegurar el mapeo
    sensor_rows = conn.execute('''
        SELECT id_lectura, id_planta_fk, fecha_medicion, humedad, ph, 
               conductividad_electrica, temperatura, radiacion_uv, radiacion_solar 
        FROM Lecturas_Sensores 
        WHERE id_planta_fk = ? 
        ORDER BY fecha_medicion ASC
    ''', (plant_id,)).fetchall()
    
    # 3. Procesamiento en Niebla (Calculos matematicos)
    processed_readings = []
    for row in sensor_rows:
        data = dict(row)
        
        # Extraer variables con valores default por seguridad
        temp = data.get('temperatura', 25.0) 
        hum = data.get('humedad', 50.0)
        uv = data.get('radiacion_uv', 0.0)
        
        # --- MAPEO DE DATOS PARA FRONTEND ---
        # El frontend espera 'solar_rad', la BD tiene 'radiacion_solar'
        data['solar_rad'] = data.get('radiacion_solar', 0.0)

        # Calcular DPV en tiempo real
        dpv_val = calcular_dpv(temp, hum)
        data['dpv'] = dpv_val 
        
        # Determinar Alerta de Estres
        data['alerta_estres'] = determinar_estres(temp, dpv_val, uv)
        
        processed_readings.append(data)

    # 4. Analisis Visuales Historicos
    visual_analyses = conn.execute('SELECT * FROM Analisis_Visuales WHERE id_planta_fk = ? ORDER BY fecha_analisis DESC', (plant_id,)).fetchall()
    
    conn.close()
    
    return { 
        "info": dict(plant_info), 
        "sensor_readings": processed_readings, 
        "visual_analyses": [dict(row) for row in visual_analyses] 
    }

class AnalysisResult(BaseModel):
    detections: list
    image_base64: str

@app.post("/api/visual_analysis/{plant_id}")
async def visual_analysis(plant_id: str, payload: AnalysisResult):
    try:
        conn = get_db_connection()
        
        # Persistencia en BD
        conn.execute(
            'INSERT INTO Analisis_Visuales (id_planta_fk, fecha_analisis, ruta_imagen_analizada, detecciones) VALUES (?, ?, ?, ?)', 
            (plant_id, datetime.now(), "base64", json.dumps(payload.detections))
        )
        
        # Actualizacion de Estado en Mapa
        if payload.detections:
            top_detection = payload.detections[0]['class_name']
            conn.execute('UPDATE Parcelas SET estado_actual = ? WHERE id_planta = ?', (f"Alerta: {top_detection}", plant_id))
        
        conn.commit()
        conn.close()
        
        return {'status': 'success', 'detections': payload.detections}
        
    except Exception as e:
        print(f"Error en analisis visual (Edge): {e}")
        raise HTTPException(status_code=500, detail=f"Error al procesar: {e}")
    
@app.get("/sw.js", include_in_schema=False)
async def serve_sw():
    return FileResponse(os.path.join(STATIC_DIR, "sw.js"), media_type="application/javascript")

# --- ARCHIVOS ESTATICOS Y ROOT ---
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=FileResponse, include_in_schema=False)
async def root():
    return os.path.join(STATIC_DIR, "index.html")

# Bloque para ejecutar directamente con: python main.py
if __name__ == "__main__":

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
