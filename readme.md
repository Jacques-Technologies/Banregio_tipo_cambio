# 💱 API de Conversión de Divisas Banregio

Una API REST que simula conversiones de monedas utilizando los tipos de cambio en tiempo real del sitio web de Banregio mediante web scraping automatizado.

## 🚀 Características

- ✅ Conversión en tiempo real de USD y EUR a MXN
- ✅ Simulación de operaciones de compra y venta
- ✅ Web scraping automatizado con Puppeteer
- ✅ Despliegue optimizado para Render.com
- ✅ Manejo robusto de errores
- ✅ Respuestas estructuradas en JSON

## 📋 Requisitos

- Node.js 16+ 
- Chrome/Chromium (manejado automáticamente por Puppeteer)

## 🛠️ Instalación

### Desarrollo Local

```bash
# Clonar el repositorio
git clone <tu-repositorio>
cd banregio-api

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm start
```

### Despliegue en Render.com

Este proyecto está optimizado para desplegar en Render.com. Simplemente:

1. Conecta tu repositorio GitHub a Render
2. El archivo `render.yaml` manejará automáticamente la configuración
3. Chrome se instalará automáticamente durante el build

## 🔧 Configuración

### Variables de Entorno

```bash
NODE_ENV=production                    # Entorno de ejecución
PORT=3000                             # Puerto del servidor
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true # Para usar Chrome optimizado
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
PUPPETEER_EXECUTABLE_PATH=/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome
```

## 📡 API Endpoints

### `GET /`
**Descripción:** Página de inicio con información básica

**Respuesta:**
```
API de Simulación de Banregio - usa /api/simular/:tipoOperacion/:moneda/:cantidad
```

### `GET /api/simular/:tipoOperacion/:moneda/:cantidad`
**Descripción:** Simula una conversión de divisa a pesos mexicanos

**Parámetros:**
- `tipoOperacion`: `compra` | `venta`
- `moneda`: `USD` | `EUR` 
- `cantidad`: Número positivo (ej: 100, 250.50)

**Ejemplo de Request:**
```
GET /api/simular/compra/USD/100
```

**Ejemplo de Respuesta Exitosa:**
```json
{
  "success": true,
  "moneda": "USD",
  "cantidad": 100,
  "tipoOperacion": "compra",
  "mxn": 1750.25,
  "tipoCambio": 17.5025,
  "fuente": "https://www.banregio.com/divisas.php",
  "timestamp": "2024-01-15T14:30:00.000Z"
}
```

**Ejemplo de Respuesta con Error:**
```json
{
  "success": false,
  "error": "Timeout waiting for selector",
  "timestamp": "2024-01-15T14:30:00.000Z"
}
```

## 🧪 Ejemplos de Uso

### cURL
```bash
# Comprar 100 USD
curl https://tu-api.onrender.com/api/simular/compra/USD/100

# Vender 50 EUR  
curl https://tu-api.onrender.com/api/simular/venta/EUR/50

# Comprar 250.75 USD
curl https://tu-api.onrender.com/api/simular/compra/USD/250.75
```

### JavaScript (Fetch)
```javascript
// Función para obtener tipo de cambio
async function obtenerTipoCambio(tipoOperacion, moneda, cantidad) {
  try {
    const response = await fetch(
      `https://tu-api.onrender.com/api/simular/${tipoOperacion}/${moneda}/${cantidad}`
    );
    const data = await response.json();
    
    if (data.success) {
      console.log(`${cantidad} ${moneda} = ${data.mxn} MXN`);
      console.log(`Tipo de cambio: ${data.tipoCambio}`);
    } else {
      console.error('Error:', data.error);
    }
    
    return data;
  } catch (error) {
    console.error('Error de red:', error);
  }
}

// Usar la función
obtenerTipoCambio('compra', 'USD', 100);
```

### Python (requests)
```python
import requests

def obtener_tipo_cambio(tipo_operacion, moneda, cantidad):
    url = f"https://tu-api.onrender.com/api/simular/{tipo_operacion}/{moneda}/{cantidad}"
    
    try:
        response = requests.get(url)
        data = response.json()
        
        if data['success']:
            print(f"{cantidad} {moneda} = {data['mxn']} MXN")
            print(f"Tipo de cambio: {data['tipoCambio']}")
        else:
            print(f"Error: {data['error']}")
            
        return data
    except Exception as e:
        print(f"Error de conexión: {e}")

# Usar la función
obtener_tipo_cambio('compra', 'USD', 100)
```

## ⚠️ Códigos de Error

| Código | Descripción |
|--------|-------------|
| 400 | Parámetros inválidos (operación, moneda o cantidad incorrecta) |
| 500 | Error interno del servidor (problema con web scraping) |

**Validaciones:**
- `tipoOperacion`: Solo acepta `compra` o `venta`
- `moneda`: Solo acepta `USD` o `EUR`
- `cantidad`: Debe ser un número positivo mayor a 0

## 🏗️ Arquitectura

```
├── index.js          # Servidor Express y rutas API
├── simulador.js      # Lógica de web scraping con Puppeteer  
├── package.json      # Dependencias y scripts
├── render.yaml       # Configuración de despliegue
└── README.md         # Documentación
```

### Flujo de Operación

1. **Request** → API recibe parámetros y valida
2. **Launch** → Puppeteer inicia Chrome headless  
3. **Navigate** → Navega a banregio.com/divisas.php
4. **Interact** → Selecciona moneda, ingresa cantidad, elige operación
5. **Extract** → Extrae resultado de conversión
6. **Response** → Retorna JSON con datos estructurados

## 🐛 Solución de Problemas

### Error: "Chrome not found"
```bash
# En desarrollo local
npm install puppeteer
# El Chrome se instala automáticamente
```

### Error: "Timeout waiting for selector"
- El sitio de Banregio puede estar lento o caído
- Verifica conectividad de red
- El selector del sitio web pudo haber cambiado

### Error de memoria en Render
- Ya configurado con `--disable-dev-shm-usage`
- Usa plan con más memoria si persiste

