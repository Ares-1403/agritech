Guía de Instalación y Ejecución del Proyecto
Este es un componente crítico de la documentación, basado en los problemas resueltos.

Prerrequisitos: Tener Python 3.8+ instalado.

Crear Entorno Virtual: Navegar a la carpeta del proyecto (Aguacate_Detect) y ejecutar:

python -m venv venv

Activar Entorno Virtual:

En Windows (PowerShell): .\venv\Scripts\Activate.ps1

En macOS/Linux: source venv/bin/activate

Instalar Dependencias: Con el entorno activo, instalar todos los paquetes necesarios:

pip install "fastapi[all]" uvicorn python-multipart ultralytics Pillow SQLAlchemy numpy

Generar la Base de Datos Simulada: Ejecutar este script una sola vez para crear y poblar el archivo database.db:

python seed_database.py

Iniciar el Servidor: Ejecutar el servidor Uvicorn. El flag --reload permite que el servidor se reinicie automáticamente al detectar cambios en el código.

uvicorn main:app --reload

Acceder a la Aplicación: Abrir un navegador web y dirigirse a la dirección: http://127.0.0.1:8000