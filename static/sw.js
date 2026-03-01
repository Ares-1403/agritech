const CACHE_NAME = 'agritech-edge-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/static/index.html',
  '/static/style.css',
  '/static/script.js',
  '/static/farm_layout.png',
  '/static/manifest.json',
  // Archivos del modelo IA (Edge Computing)
  '/static/best_web_model/model.json',
  '/static/best_web_model/group1-shard1of3.bin',
  '/static/best_web_model/group1-shard2of3.bin',
  '/static/best_web_model/group1-shard3of3.bin',
  '/static/best_web_model/metadata.yaml'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Archivos cacheados para uso offline');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Ignorar peticiones a la API para traer siempre datos frescos de sensores
  if (event.request.url.includes('/api/')) {
    return; 
  }

  // Estrategia Cache-First para los archivos pesados y la UI
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});