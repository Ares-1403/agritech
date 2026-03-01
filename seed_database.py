import sqlite3
import random
from datetime import datetime, timedelta
import math
import os

# --- CONFIGURACION ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_NAME = os.path.join(BASE_DIR, "database.db")
NUM_PLANTS = 35
DAYS_OF_DATA = 30 

# Coordenadas: Zona Aguacatera Michoacan
MIN_LAT, MAX_LAT = 19.400, 19.420
MIN_LON, MAX_LON = -102.050, -102.030

VARIETIES = ["Hass", "Fuerte", "Mendez", "Flor de Maria"]

def create_database():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Parcelas (
            id_planta TEXT PRIMARY KEY, 
            ubicacion_gps TEXT NOT NULL,
            variedad_aguacate TEXT, 
            fecha_siembra DATE, 
            estado_actual TEXT
        )
    ''')
    
    # ACTUALIZACION: Se agrego la columna 'radiacion_solar'
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Lecturas_Sensores (
            id_lectura INTEGER PRIMARY KEY AUTOINCREMENT, 
            id_planta_fk TEXT,
            fecha_medicion TIMESTAMP, 
            humedad REAL, 
            ph REAL, 
            conductividad_electrica REAL,
            temperatura REAL,
            radiacion_uv REAL,
            radiacion_solar REAL, 
            FOREIGN KEY (id_planta_fk) REFERENCES Parcelas (id_planta)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Analisis_Visuales (
            id_analisis INTEGER PRIMARY KEY AUTOINCREMENT, 
            id_planta_fk TEXT,
            fecha_analisis TIMESTAMP, 
            ruta_imagen_analizada TEXT, 
            detecciones TEXT,
            FOREIGN KEY (id_planta_fk) REFERENCES Parcelas (id_planta)
        )
    ''')
    
    conn.commit()
    conn.close()
    print("Esquema de base de datos verificado (incluyendo Radiacion Solar).")

def get_weather_event():
    roll = random.random()
    if roll < 0.50: return "soleado"
    if roll < 0.80: return "nublado"
    if roll < 0.90: return "lluvia"
    return "ola_calor"

def seed_data():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Limpieza total para regenerar con el nuevo esquema
    cursor.execute("DELETE FROM Lecturas_Sensores")
    cursor.execute("DELETE FROM Analisis_Visuales")
    cursor.execute("DELETE FROM Parcelas")
    print("Base de datos limpiada. Iniciando simulacion de Campana de Gauss...")

    # --- DEFINICION DE ESCENARIOS ---
    scenarios = []
    
    # 5 Falta de Riego (Azules)
    for _ in range(5): scenarios.append("falta_riego")
    # 3 Exceso de Humedad (Rojas)
    for _ in range(3): scenarios.append("exceso_humedad")
    # 3 Alertas Varias (Rojas)
    scenarios.append("alerta_termica")
    scenarios.append("alerta_ph")
    scenarios.append("alerta_salinidad")
    # 24 Saludables (Verdes)
    for _ in range(24): scenarios.append("saludable")
    
    random.shuffle(scenarios)

    # Fechas
    end_date = datetime.now()
    start_simulation_date = end_date - timedelta(days=DAYS_OF_DATA)

    # Clima base diario
    daily_weather_log = {}
    current_d = start_simulation_date
    while current_d <= end_date:
        daily_weather_log[current_d.date()] = get_weather_event()
        current_d += timedelta(days=1)

    # --- BUCLE DE PLANTAS ---
    for i in range(NUM_PLANTS):
        plant_id = f"P-{str(i+1).zfill(3)}"
        scenario = scenarios[i]
        
        # Datos estaticos
        lat = random.uniform(MIN_LAT, MAX_LAT)
        lon = random.uniform(MIN_LON, MAX_LON)
        gps = f"{lat},{lon}"
        variety = random.choice(VARIETIES)
        sowing_date = (datetime.now() - timedelta(days=random.randint(365, 1095))).date()

        # Configuracion Fisica
        irrigation_status = "working" 
        force_heat = False
        ph_bias = 0.0
        ec_bias = 0.0
        
        if scenario == "falta_riego":
            irrigation_status = "broken"
            soil_retention = 0.6 
            current_humidity = 60.0 
        elif scenario == "exceso_humedad":
            irrigation_status = "leaking"
            soil_retention = 1.5 
            current_humidity = 80.0 
        elif scenario == "alerta_termica":
            force_heat = True
            soil_retention = 1.0
            current_humidity = 50.0
        elif scenario == "alerta_ph":
            ph_bias = -1.5 
            soil_retention = 1.0
            current_humidity = 50.0
        elif scenario == "alerta_salinidad":
            ec_bias = 2.0
            soil_retention = 1.0
            current_humidity = 40.0
        else: # Saludable
            soil_retention = random.uniform(0.9, 1.1)
            current_humidity = 50.0

        base_ph = random.uniform(6.2, 6.8)

        sensor_data_list = []
        sim_date = start_simulation_date
        
        # --- BUCLE DE TIEMPO (CADA 1 HORA PARA MEJOR RESOLUCION DE CURVA) ---
        while sim_date <= end_date:
            day_weather = daily_weather_log[sim_date.date()]
            hour = sim_date.hour
            is_last_day = (end_date - sim_date).days < 1

            # Factor tiempo para temperatura (Seno desplazado)
            time_factor = math.sin(math.pi * (hour - 9) / 12) 
            
            if force_heat and is_last_day: day_weather = "ola_calor" 

            # Definicion de Maximos Diarios
            # rad_m = Radiacion Solar Maxima en W/m2
            if day_weather == "soleado":
                max_t = 28; min_t = 16; uv_m = 9.0; rad_m = 950; cloud = 0.0
            elif day_weather == "ola_calor":
                max_t = 36; min_t = 22; uv_m = 13.5; rad_m = 1150; cloud = 0.0 # UV Extremo forzado
                if force_heat: max_t = 39 
            elif day_weather == "nublado":
                max_t = 24; min_t = 18; uv_m = 4.0; rad_m = 350; cloud = 0.6
            else: # Lluvia
                max_t = 20; min_t = 15; uv_m = 2.0; rad_m = 150; cloud = 0.9

            # 1. TEMPERATURA
            trange = (max_t - min_t) / 2
            tavg = (max_t + min_t) / 2
            curr_temp = tavg + (trange * time_factor) + random.uniform(-0.5, 0.5)

            # 2. RADIACION UV y SOLAR (Campana de Gauss)
            curr_uv = 0.0
            curr_rad = 0.0
            
            # El sol sale a las 6 y se pone a las 19
            if 6 <= hour <= 19:
                # Usamos una funcion seno perfecta para simular la campana
                # Normalizamos las horas de luz (13 horas) a PI radianes
                s_ang = math.sin(math.pi * (hour - 6) / 13) 
                
                if s_ang < 0: s_ang = 0 # Evitar negativos por errores de punto flotante
                
                # Calculo con ruido minimo para mantener la forma de campana
                curr_uv = uv_m * s_ang * (1 - cloud) + random.uniform(-0.2, 0.2)
                curr_rad = rad_m * s_ang * (1 - cloud) + random.uniform(-20, 20)

                # Limpieza de valores negativos
                if curr_uv < 0: curr_uv = 0
                if curr_rad < 0: curr_rad = 0

            # 3. HUMEDAD
            if day_weather == "lluvia":
                if scenario == "falta_riego":
                    current_humidity += random.uniform(0.5, 1.5) 
                else:
                    current_humidity += random.uniform(5, 8)
            else:
                # Evaporacion correlacionada con radiacion solar
                evap_base = (curr_temp / 10) * 0.1
                evap_solar = (curr_rad / 1000) * 0.2 # Mas sol = mas evaporacion
                evap = evap_base + evap_solar
                
                if scenario == "falta_riego": evap *= 1.2
                current_humidity -= (evap / soil_retention)

            # Riego / Fugas
            if irrigation_status == "leaking" and hour in [20, 0, 4]:
                current_humidity += 5 
            elif irrigation_status == "working":
                if current_humidity < 30 and hour in [20, 0, 4]:
                    current_humidity += 15 # Recarga gradual

            if scenario not in ["falta_riego", "exceso_humedad"] and current_humidity < 35:
                current_humidity = 40 

            current_humidity = max(5.0, min(99.0, current_humidity))

            # 4. CONDUCTIVIDAD & pH
            ec_f = 1 + ((100 - current_humidity) / 100)
            base_ec = 1.0 + ec_bias
            curr_ec = min(4.5, max(0.2, base_ec * ec_f))

            ph_drift = -0.1 if day_weather == "lluvia" else 0
            curr_ph = base_ph + ph_drift + ph_bias + random.uniform(-0.05, 0.05)

            # --- GUARDADO CADA HORA (AJUSTE CRITICO) ---
            # Se ha eliminado el 'if hour % 2 == 0' para tener resolucion completa de 24h
            sensor_data_list.append((
                plant_id, sim_date, 
                round(current_humidity, 2), round(curr_ph, 1), 
                round(curr_ec, 2), round(curr_temp, 1), 
                round(curr_uv, 1), int(curr_rad) # Integers para W/m2
            ))
            
            sim_date += timedelta(hours=1) # Paso de simulacion de 1 hora

        # --- ESTADO FINAL ---
        status = "Saludable"
        if scenario == "falta_riego": status = "Requiere Riego"
        elif scenario == "exceso_humedad": status = "Alerta: Exceso de Humedad"
        elif "alerta" in scenario:
            if "termica" in scenario: status = "Alerta: Estrés Termico"
            if "ph" in scenario: status = "Alerta: pH Acido"
            if "salinidad" in scenario: status = "Alerta: Salinidad Alta"
        
        cursor.execute("INSERT INTO Parcelas VALUES (?, ?, ?, ?, ?)", 
                       (plant_id, gps, variety, sowing_date, status))

        cursor.executemany("""
            INSERT INTO Lecturas_Sensores 
            (id_planta_fk, fecha_medicion, humedad, ph, conductividad_electrica, temperatura, radiacion_uv, radiacion_solar) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, sensor_data_list)

    conn.commit()
    conn.close()
    print("Simulacion completada con Radiacion Solar y UV sinusoidal.")
    print(" - Tabla Lecturas_Sensores actualizada con columna 'radiacion_solar'.")

if __name__ == "__main__":
    # Eliminacion automatica de la BD antigua para evitar conflictos de esquema
    if os.path.exists(DB_NAME):
        try:
            os.remove(DB_NAME)
            print("Base de datos anterior eliminada para aplicar nueva estructura.")
        except:
            print("No se pudo borrar la BD (puede estar en uso).")

    create_database()
    seed_data()