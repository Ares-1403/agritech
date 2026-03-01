document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. CONFIGURACION CENTRALIZADA
    // ==========================================
    const CHART_CONFIGS = {
        'humedad': {
            label: 'Humedad',
            key: 'humedad',
            color: '#1976D2',
            yTitle: 'Humedad (% VWC)',
            unit: '%',
            min: 0, max: 100,
            getValue: (r) => r.humedad,
            isDual: false
        },
        'ph': {
            label: 'pH del Suelo',
            key: 'ph',
            color: '#ff9f40',
            yTitle: 'Escala pH (0-14)',
            unit: '',
            min: 0, max: 14,
            getValue: (r) => r.ph,
            isDual: false,
            tooltipTag: (val) => val < 6 ? ' (Acido)' : (val > 7.5 ? ' (Alcalino)' : ' (Neutro)')
        },
        'conductividad': {
            label: 'Conductividad',
            key: 'conductividad_electrica',
            color: '#4bc0c0',
            yTitle: 'Conductividad (dS/m)',
            unit: ' dS/m',
            getValue: (r) => r.conductividad_electrica,
            isDual: false
        },
        'clima': {
            isDual: true,
            yTitleLeft: 'Temperatura (C)',
            yTitleRight: 'DPV (kPa)',
            datasets: [
                { label: 'Temperatura', key: 'temperatura', color: '#ff6384', yAxis: 'y', unit: 'C' },
                { label: 'DPV', key: 'dpv', color: '#4FC3F7', yAxis: 'y1', unit: ' kPa' }
            ]
        }
    };

    // ==========================================
    // 2. ESTADO Y DOM
    // ==========================================
    const UI = {
        map: document.getElementById('farm-map'),
        charts: {
            canvas: document.getElementById('sensor-chart'),
            wrapper: document.querySelector('.chart-wrapper'),
            uvContainer: document.getElementById('uv-interface'),
            uvList: document.getElementById('uv-days-container'),
            uvDetail: document.getElementById('uv-detail-view'),
            uvTitle: document.getElementById('uv-detail-title'),
            uvCanvas: document.getElementById('uv-daily-chart'),
            uvSummary: document.getElementById('uv-detail-summary'),
            uvBackBtn: document.getElementById('back-to-uv')
        },
        panels: {
            placeholder: document.getElementById('plant-placeholder'),
            data: document.getElementById('plant-data-view')
        },
        info: {
            id: document.getElementById('plant-id-title'),
            variety: document.getElementById('plant-variety'),
            date: document.getElementById('plant-sowing-date'),
            status: document.getElementById('plant-status')
        },
        upload: {
            input: document.getElementById('file-input'),
            list: document.getElementById('detections-list'),
            preview: document.getElementById('image-preview'),
            result: document.getElementById('analyzed-image'),
            iconPreview: document.getElementById('preview-icon-placeholder'),
            iconAnalysis: document.getElementById('analysis-icon-placeholder')
        }
    };

    let state = {
        map: null,
        mainChart: null,
        uvChart: null,
        plantId: null,
        readings: [],
        selectedLayer: null 
    };

    // --- ESTADO DE IA (EDGE COMPUTING) CORREGIDO ---
    let tfModel = null;
    // CLASES EXACTAS SEGÚN TU DATA.YAML
    const CLASSES = ["Antracnosis", "Mancha de Alga", "Rona", "Sarna", "Fumagina"]; 

    async function initTF() {
        try {
            tfModel = await tf.loadGraphModel('/static/best_web_model/model.json');
            console.log("Modelo Edge AI cargado en memoria RAM.");
        } catch(e) { console.error("Error cargando IA:", e); }
    }
    initTF();

    // ==========================================
    // 3. UTILIDADES
    // ==========================================
    function parseDate(dateString) {
        if (!dateString) return new Date();
        const safeString = dateString.replace(' ', 'T'); 
        return new Date(safeString);
    }

    function processDailyData(readings, key) {
        const dailyMap = {};
        readings.forEach(r => {
            const dateObj = parseDate(r.fecha_medicion);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const dateKey = `${year}-${month}-${day}`;
            
            if (!dailyMap[dateKey]) {
                dailyMap[dateKey] = { sum: 0, count: 0, min: Infinity, max: -Infinity, readings: [] };
            }

            const val = r[key] || 0;
            dailyMap[dateKey].sum += val;
            dailyMap[dateKey].count += 1;
            if (val < dailyMap[dateKey].min) dailyMap[dateKey].min = val;
            if (val > dailyMap[dateKey].max) dailyMap[dateKey].max = val;
            dailyMap[dateKey].readings.push(r);
        });

        return Object.keys(dailyMap).sort().map(dateKey => {
            const dayData = dailyMap[dateKey];
            return {
                fecha: dateKey,
                valor: parseFloat((dayData.sum / dayData.count).toFixed(2)),
                min: dayData.min,
                max: dayData.max
            };
        });
    }

    // ==========================================
    // 4. GRAFICAS PRINCIPALES
    // ==========================================
    function renderMainChart(type) {
        const ctx = UI.charts.canvas.getContext('2d');
        if (state.mainChart) state.mainChart.destroy();

        const config = CHART_CONFIGS[type];
        let chartLabels = [];
        let chartDatasets = [];

        if (config.isDual) {
            const sortedRaw = state.readings.sort((a, b) => parseDate(a.fecha_medicion) - parseDate(b.fecha_medicion));
            if (sortedRaw.length === 0) return;

            const firstDate = parseDate(sortedRaw[0].fecha_medicion);
            const startDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());

            const data1 = processDailyData(state.readings, config.datasets[0].key);
            const data2 = processDailyData(state.readings, config.datasets[1].key);

            chartLabels = data1.map(d => {
                const parts = d.fecha.split('-');
                const currentDate = new Date(parts[0], parts[1] - 1, parts[2]);
                const diffTime = currentDate - startDate;
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 
                return diffDays + 1; 
            });

            chartDatasets = config.datasets.map((ds, i) => {
                const dataSrc = i === 0 ? data1 : data2;
                return {
                    label: ds.label,
                    data: dataSrc.map(d => d.valor),
                    extraData: dataSrc.map(d => ({ min: d.min, max: d.max })),
                    borderColor: ds.color,
                    backgroundColor: ds.color + '1A',
                    yAxisID: ds.yAxis,
                    tension: 0.4,
                    pointRadius: 4,
                    borderWidth: 2
                };
            });

        } else {
            const dailyData = processDailyData(state.readings, config.key);
            if (dailyData.length === 0) return;

            const partsStart = dailyData[0].fecha.split('-');
            const startDate = new Date(partsStart[0], partsStart[1] - 1, partsStart[2]);

            chartLabels = dailyData.map(d => {
                const parts = d.fecha.split('-');
                const current = new Date(parts[0], parts[1] - 1, parts[2]);
                const diffTime = current - startDate;
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 
                return diffDays + 1;
            });

            chartDatasets = [{
                label: config.label,
                data: dailyData.map(d => d.valor), 
                extraData: dailyData.map(d => ({ min: d.min, max: d.max })), 
                borderColor: config.color,
                backgroundColor: config.color + '33',
                fill: true,
                tension: 0.3,
                pointRadius: 5, 
                pointHoverRadius: 7,
                borderWidth: 2
            }];
        }

        const chartScales = config.isDual ? {
            y: { type: 'linear', position: 'left', title: { display: true, text: config.yTitleLeft } },
            y1: { type: 'linear', position: 'right', title: { display: true, text: config.yTitleRight }, grid: { drawOnChartArea: false } }
        } : {
            y: { 
                title: { display: true, text: config.yTitle },
                min: config.min !== undefined ? config.min : undefined,
                max: config.max !== undefined ? config.max : undefined
            }
        };

        state.mainChart = new Chart(ctx, {
            type: 'line',
            data: { labels: chartLabels, datasets: chartDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        title: { display: true, text: 'Dias de Monitoreo (Promedio Diario)' },
                        grid: { display: false },
                        ticks: { maxRotation: 0, minRotation: 0, autoSkip: false, font: { size: 10 } }
                    },
                    ...chartScales
                },
                plugins: {
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        padding: 10,
                        callbacks: {
                            title: function(context) { return `Dia ${context[0].label}`; },
                            label: function(context) {
                                const ds = context.dataset;
                                const idx = context.dataIndex;
                                const value = context.parsed.y;
                                const extra = ds.extraData[idx];
                                const unit = config.unit || (config.datasets ? config.datasets[context.datasetIndex].unit : '');
                                let clasificacion = '';
                                if (config.tooltipTag) clasificacion = config.tooltipTag(value); 
                                return [
                                    ` Media: ${value}${unit}${clasificacion}`, 
                                    ` Max: ${extra.max}${unit}`,
                                    ` Min: ${extra.min}${unit}`
                                ];
                            }
                        }
                    }
                }
            }
        });
    }

    // ==========================================
    // 5. MODULO UV Y RADIACION SOLAR
    // ==========================================
    function renderUVModule() {
        UI.charts.uvList.innerHTML = '';
        const daysGroup = {};
        
        state.readings.forEach(r => {
            const d = parseDate(r.fecha_medicion);
            const key = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
            if (!daysGroup[key]) daysGroup[key] = [];
            daysGroup[key].push(r);
        });

        Object.keys(daysGroup).forEach((dateStr, index) => {
            const dayReadings = daysGroup[dateStr];
            const maxUV = Math.max(...dayReadings.map(r => r.radiacion_uv || 0));
            const isDanger = maxUV > 9;

            const item = document.createElement('div');
            item.className = 'uv-day-item';
            item.innerHTML = `
                <span class="uv-date">Dia ${index + 1} <small style="color:#999">(${dateStr})</small></span>
                <div class="uv-status">
                    <span class="uv-value" style="${isDanger ? 'color:#f44336;font-weight:bold' : ''}">
                        Max: ${maxUV.toFixed(1)}
                    </span>
                    <div class="danger-bulb ${isDanger ? 'active' : ''}"></div>
                </div>
            `;
            item.onclick = () => showUVDetail(dateStr, dayReadings);
            UI.charts.uvList.appendChild(item);
        });
    }

    function showUVDetail(dateStr, readings) {
        document.getElementById('uv-list-view').classList.add('hidden');
        UI.charts.uvDetail.classList.remove('hidden');
        UI.charts.uvTitle.textContent = `Ciclo Solar: ${dateStr}`;

        readings.sort((a,b) => parseDate(a.fecha_medicion) - parseDate(b.fecha_medicion));
        
        const labels = readings.map(r => {
            const h = parseDate(r.fecha_medicion).getHours();
            return `${String(h).padStart(2, '0')}:00`;
        });
        const dataUV = readings.map(r => r.radiacion_uv || 0);
        const dataSolar = readings.map(r => r.solar_rad || 0);

        const ctx = UI.charts.uvCanvas.getContext('2d');
        if (state.uvChart) state.uvChart.destroy();

        state.uvChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Radiacion Solar (W/m2)',
                        data: dataSolar,
                        borderColor: '#ffc107', 
                        backgroundColor: 'rgba(255, 193, 7, 0.2)',
                        yAxisID: 'y', 
                        tension: 0.4, 
                        fill: true,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        borderWidth: 3,
                        order: 2
                    },
                    {
                        label: 'Indice UV',
                        data: dataUV,
                        borderColor: '#9c27b0', 
                        backgroundColor: 'rgba(156, 39, 176, 0.05)',
                        yAxisID: 'y1', 
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        borderWidth: 3,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } 
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Radiacion Solar (W/m2)',
                            color: '#333333', 
                            font: { weight: 'bold' }
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        max: 15, 
                        grid: { drawOnChartArea: false },
                        title: {
                            display: true,
                            text: 'Indice UV',
                            color: '#333333',
                            font: { weight: 'bold' }
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#333' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y;
                                    if(context.dataset.yAxisID === 'y') label += ' W/m2';
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });

        const maxUvVal = Math.max(...dataUV);
        const maxRadVal = Math.max(...dataSolar);
        
        UI.charts.uvSummary.innerHTML = maxUvVal > 9 
            ? `<strong>Peligro:</strong> Radiacion extrema (${maxRadVal} W/m2 / UV ${maxUvVal.toFixed(1)}).` 
            : `Ciclo normal. Pico solar: ${maxRadVal} W/m2.`;
        UI.charts.uvSummary.style.color = maxUvVal > 9 ? '#f44336' : '#4CAF50';
    }

    // ==========================================
    // 6. NAVEGACION Y CARGA
    // ==========================================
    function switchTab(chartKey) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.chart === chartKey);
        });

        if (chartKey === 'uv') {
            UI.charts.wrapper.classList.add('hidden');
            UI.charts.uvContainer.classList.remove('hidden');
            renderUVModule();
        } else {
            UI.charts.wrapper.classList.remove('hidden');
            UI.charts.uvContainer.classList.add('hidden');
            setTimeout(() => renderMainChart(chartKey), 10);
        }
    }

    async function loadPlant(id) {
        state.plantId = id;
        UI.panels.placeholder.classList.add('hidden');
        UI.panels.data.classList.remove('hidden');

        try {
            const res = await fetch(`/api/plant_data/${id}`);
            const data = await res.json();
            
            UI.info.id.textContent = `Sensor: ${data.info.id_planta}`;
            UI.info.variety.textContent = data.info.variedad_aguacate;
            UI.info.date.textContent = new Date(data.info.fecha_siembra).toLocaleDateString();
            
            let statusHtml = data.info.estado_actual;
            const last = data.sensor_readings[data.sensor_readings.length - 1];
            
            if (last && last.alerta_estres) statusHtml += ` <strong style="color:#f44336">(ESTRES)</strong>`;
            UI.info.status.innerHTML = statusHtml;

            state.readings = data.sensor_readings;
            resetUploadUI();
            switchTab('humedad');

        } catch (e) { console.error(e); }
    }

    // ==========================================
    // 7. MAPA
    // ==========================================
    function renderMarkers(plants) {
        state.map.eachLayer(l => { if(l instanceof L.CircleMarker) l.remove(); });
        state.selectedLayer = null;

        plants.forEach(p => {
            const [lat, lon] = p.ubicacion_gps.split(',').map(parseFloat);
            
            const minLat = 19.400; const maxLat = 19.420;
            const minLon = -102.050; const maxLon = -102.030;

            const paddingX = 80; 
            const paddingY = 60; 
            
            const effectiveWidth = 1179 - (paddingX * 2);
            const effectiveHeight = 751 - (paddingY * 2);

            const x = paddingX + ((lon - minLon) / (maxLon - minLon)) * effectiveWidth;
            const y = 751 - (paddingY + ((lat - minLat) / (maxLat - minLat)) * effectiveHeight);
            
            let color = '#4CAF50'; 
            if(p.estado_actual.includes('Alerta')) color = '#f44336'; 
            if(p.estado_actual.includes('Riego')) color = '#2196F3';  

            const marker = L.circleMarker([y, x], { 
                radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 
            });

            marker.on('click', function() {
                if (state.selectedLayer) {
                    state.selectedLayer.setStyle({ color: '#fff', weight: 2 });
                }
                this.setStyle({ color: '#000000', weight: 3 });
                state.selectedLayer = this;
                
                loadPlant(p.id_planta);
            });

            marker.addTo(state.map);
        });
    }

    // ==========================================
    // 8. GENERADOR DE REPORTES PDF
    // ==========================================
    document.getElementById('btn-report').addEventListener('click', generatePDF);

    function generatePDF() {
        if (!state.plantId) {
            alert("Por favor, selecciona un sensor primero.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFillColor(30, 30, 30); 
        doc.rect(0, 0, 210, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text("Plataforma Integral de Monitoreo de Cultivos", 105, 18, { align: "center" });
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Fecha de Corte: ${new Date().toLocaleString()}`, 105, 26, { align: "center" });

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(`Sensor: ${state.plantId}`, 15, 45);
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.text(`Variedad: ${UI.info.variety.textContent}`, 15, 52);
        
        let rawStatus = UI.info.status.textContent || "";
        doc.text(`Estado: ${rawStatus}`, 100, 52);

        doc.setDrawColor(200, 200, 200);
        doc.line(15, 58, 195, 58); 
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Evidencia Visual e Inferencia IA", 15, 65);

        let currentY = 170;

        try {
            const imgOriginal = document.getElementById('image-preview');
            const imgAnalyzed = document.getElementById('analyzed-image');

            if (!imgAnalyzed.classList.contains('hidden')) {
                doc.addImage(imgOriginal, 'JPEG', 15, 70, 80, 80);
                doc.addImage(imgAnalyzed, 'JPEG', 110, 70, 80, 80);
                
                doc.setFontSize(9);
                doc.setFont("helvetica", "normal");
                doc.text("Imagen Original (Sensor)", 15, 155);
                doc.text("Procesamiento de Inferencia", 110, 155);

                doc.setFontSize(10);
                doc.setFont("helvetica", "bold");
                doc.text("Resultados del Modelo:", 15, 165);
                
                currentY = 170;
                const listItems = document.querySelectorAll('#detections-list li');
                doc.setFont("courier", "normal"); 
                
                listItems.forEach(item => {
                    if (currentY > 270) { doc.addPage(); currentY = 20; }
                    doc.text(`- ${item.textContent}`, 20, currentY);
                    currentY += 6;
                });
            } else {
                doc.setFontSize(10);
                doc.setFont("helvetica", "italic");
                doc.text("No hay analisis visual registrado recientemente.", 15, 80);
                currentY = 100;
            }
        } catch (e) {
            console.warn("Error PDF imagenes", e);
        }

        currentY += 10;
        if (currentY + 90 > 280) { doc.addPage(); currentY = 20; }
        
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Metricas Ambientales (Estado Actual vs. Maximos)", 15, currentY);

        let barY = currentY + 15;

        if (state.readings && state.readings.length > 0) {
            const lastData = state.readings[state.readings.length - 1];
            const allUV = state.readings.map(r => r.radiacion_uv || 0);
            const allSol = state.readings.map(r => r.solar_rad || 0);
            const maxUV = Math.max(...allUV);
            const maxSol = Math.max(...allSol);

            const metrics = [
                { label: "Humedad (%)", value: lastData.humedad, max: 100, color: [25, 118, 210] },
                { label: "pH Suelo (0-14)", value: lastData.ph, max: 14, color: [255, 159, 64] },
                { label: "Conductividad (dS/m)", value: lastData.conductividad_electrica, max: 5, color: [75, 192, 192] },
                { label: "Temp. (C)", value: lastData.temperatura, max: 50, color: [255, 99, 132] },
                { label: "DPV (kPa)", value: lastData.dpv, max: 3, color: [79, 195, 247] },
                { label: "Rad. UV (Max. Historico)", value: maxUV, max: 15, color: [156, 39, 176] },
                { label: "Rad. Solar (Max. W/m2)", value: maxSol, max: 1200, color: [255, 205, 86] }
            ];

            const barHeight = 7; 
            const maxBarWidth = 100;
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");

            metrics.forEach(m => {
                doc.setTextColor(0,0,0);
                doc.text(m.label, 15, barY + 5);
                doc.setFillColor(240, 240, 240);
                doc.rect(60, barY, maxBarWidth, barHeight, 'F');
                const safeValue = Math.min(m.value, m.max);
                const valueWidth = (safeValue / m.max) * maxBarWidth;
                doc.setFillColor(m.color[0], m.color[1], m.color[2]);
                doc.rect(60, barY, valueWidth, barHeight, 'F');
                doc.text(String(m.value), 60 + valueWidth + 2, barY + 5);
                barY += 12; 
            });

            currentY = barY + 10;
            if (currentY + 50 > 280) { doc.addPage(); currentY = 20; }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text("Diagnostico Tecnico", 15, currentY);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            currentY += 8;

            const warnings = [];
            if (lastData.humedad < 30) warnings.push("[CRITICO] Humedad baja detectada. Riego requerido.");
            if (lastData.humedad > 85) warnings.push("[ALERTA] Exceso de humedad. Riesgo fungico.");
            if (lastData.ph < 6) warnings.push("[ACIDEZ] pH bajo. Suelo acido.");
            if (lastData.radiacion_uv > 9) warnings.push("[PELIGRO] Radiacion UV extrema.");
            if (lastData.dpv > 2.0) warnings.push("[ESTRES] DPV Alto. Cierre estomatico.");
            
            if (rawStatus.includes("Alerta")) {
                let cleanDisease = rawStatus.replace("Alerta:", "").trim();
                warnings.push(`[VISUAL] Patologia detectada: ${cleanDisease}`);
            }

            if (warnings.length === 0) {
                doc.setTextColor(0, 100, 0); 
                doc.text("[OK] Parametros nominales. Cultivo estable.", 15, currentY);
            } else {
                doc.setTextColor(180, 0, 0); 
                warnings.forEach(w => {
                    doc.text(w, 15, currentY);
                    currentY += 6;
                });
            }
        } else {
            doc.text("Sin datos telemetricos disponibles.", 15, currentY + 10);
        }

        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text("Reporte generado automaticamente - Sistema AgriTech", 105, 290, null, null, "center");
        doc.save(`Reporte_Tecnico_${state.plantId}.pdf`);
    }

    function initMap() {
        state.map = L.map(UI.map, { crs: L.CRS.Simple, minZoom: -1, maxZoom: 2, attributionControl: false, zoomControl: false });
        const bounds = [[0, 0], [751, 1179]];
        L.imageOverlay('/static/farm_layout.png', bounds).addTo(state.map);
        state.map.fitBounds(bounds);
        
        fetch('/api/farm_map')
            .then(r => r.json())
            .then(plants => { renderMarkers(plants); });
    }

    function resetUploadUI() {
        UI.upload.list.innerHTML = '';
        UI.upload.input.value = '';
        UI.upload.preview.classList.add('hidden');
        UI.upload.result.classList.add('hidden');
        UI.upload.iconPreview.classList.remove('hidden');
        UI.upload.iconAnalysis.classList.remove('hidden');
    }

    // ==========================================
    // 9. INFERENCIA Y DIBUJO (CANVAS NMS)
    // ==========================================
    UI.upload.input.addEventListener('change', async (e) => {
        if (!state.plantId) return alert("Selecciona un sensor.");
        if (!tfModel) return alert("El modelo IA se está cargando. Espera unos segundos.");

        const file = e.target.files[0];
        const reader = new FileReader();

        reader.onload = async (ev) => {
            UI.upload.preview.src = ev.target.result;
            UI.upload.preview.classList.remove('hidden');
            UI.upload.iconPreview.classList.add('hidden');
            UI.upload.list.innerHTML = 'Analizando matrices localmente...';

            const imgElement = new Image();
            imgElement.src = ev.target.result;
            
            imgElement.onload = async () => {
                try {
                    // 1. PREPROCESAMIENTO (A Tensor 640x640)
                    const tensor = tf.browser.fromPixels(imgElement)
                        .resizeBilinear([640, 640])
                        .div(255.0)
                        .expandDims(0);

                    // 2. INFERENCIA
                    const predictions = await tfModel.executeAsync(tensor);
                    const data = await predictions.data();
                    
                    // 3. EXTRACCIÓN DE CAJAS (YOLOv8 Output: [1, 4 + Clases, 8400])
                    const numClasses = CLASSES.length;
                    const numAnchors = 8400;
                    
                    let boxes = [];
                    let scores = [];
                    let classIds = [];

                    for (let i = 0; i < numAnchors; i++) {
                        let maxScore = 0;
                        let classIndex = -1;

                        for (let c = 0; c < numClasses; c++) {
                            const score = data[(4 + c) * numAnchors + i];
                            if (score > maxScore) {
                                maxScore = score;
                                classIndex = c;
                            }
                        }

                        if (maxScore > 0.40) { // Umbral general
                            const xc = data[0 * numAnchors + i];
                            const yc = data[1 * numAnchors + i];
                            const w = data[2 * numAnchors + i];
                            const h = data[3 * numAnchors + i];

                            // Convertir formato para TensorFlow NMS [y1, x1, y2, x2]
                            boxes.push([yc - h / 2, xc - w / 2, yc + h / 2, xc + w / 2]);
                            scores.push(maxScore);
                            classIds.push(classIndex);
                        }
                    }

                    tf.dispose([tensor, predictions]);

                    // 4. NON-MAXIMUM SUPPRESSION (NMS) Y DIBUJO
                    let detectionsList = [];
                    let finalImageBase64 = ev.target.result;

                    if (boxes.length > 0) {
                        const boxesTensor = tf.tensor2d(boxes, [boxes.length, 4]);
                        const scoresTensor = tf.tensor1d(scores);
                        
                        // Eliminar detecciones duplicadas en la misma área
                        const indicesTensor = await tf.image.nonMaxSuppressionAsync(boxesTensor, scoresTensor, 15, 0.45, 0.45);
                        const indices = indicesTensor.dataSync();
                        tf.dispose([boxesTensor, scoresTensor, indicesTensor]);

                        // Preparar Canvas para dibujar
                        const canvas = document.createElement('canvas');
                        canvas.width = imgElement.width;
                        canvas.height = imgElement.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(imgElement, 0, 0);

                        // Escalar coordenadas (IA vio 640x640, pero la foto original tiene otra resolución)
                        const scaleX = canvas.width / 640;
                        const scaleY = canvas.height / 640;

                        ctx.lineWidth = 5;
                        ctx.font = "bold 26px Montserrat, sans-serif";
                        ctx.textBaseline = "top";

                        indices.forEach(i => {
                            const [y1, x1, y2, x2] = boxes[i];
                            const cls = classIds[i];
                            const score = scores[i];
                            const className = CLASSES[cls];

                            const rx1 = x1 * scaleX;
                            const ry1 = y1 * scaleY;
                            const rw = (x2 - x1) * scaleX;
                            const rh = (y2 - y1) * scaleY;

                            const color = '#f44336'; // Rojo de Alerta
                            
                            // Dibujar Caja
                            ctx.strokeStyle = color;
                            ctx.strokeRect(rx1, ry1, rw, rh);
                            
                            // Dibujar Fondo del Texto
                            const text = `${className} ${(score * 100).toFixed(1)}%`;
                            const textWidth = ctx.measureText(text).width;
                            ctx.fillStyle = color;
                            ctx.fillRect(rx1 - 2, ry1 - 35, textWidth + 14, 35);
                            
                            // Dibujar Texto
                            ctx.fillStyle = '#ffffff';
                            ctx.fillText(text, rx1 + 5, ry1 - 32);

                            detectionsList.push({
                                class_name: className,
                                confidence: (score * 100).toFixed(2) + "%"
                            });
                        });
                        
                        finalImageBase64 = canvas.toDataURL('image/jpeg', 0.8);
                    }

                    // 5. ACTUALIZAR INTERFAZ Y BASE DE DATOS
                    const html = detectionsList.length 
                        ? '<ul>' + detectionsList.map(x=>`<li><strong>${x.class_name}</strong>: ${x.confidence}</li>`).join('') + '</ul>' 
                        : 'No se encontraron patologías en la hoja.';
                    UI.upload.list.innerHTML = html;

                    UI.upload.result.src = finalImageBase64;
                    UI.upload.result.classList.remove('hidden');
                    UI.upload.iconAnalysis.classList.add('hidden');

                    if(detectionsList.length > 0) {
                        const topDisease = detectionsList[0].class_name;
                        UI.info.status.innerHTML = `<strong style="color:#f44336">Alerta: ${topDisease}</strong>`;
                    } else {
                        UI.info.status.innerHTML = `<strong style="color:#4CAF50">Saludable</strong>`;
                    }

                    await fetch(`/api/visual_analysis/${state.plantId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            detections: detectionsList,
                            image_base64: finalImageBase64 
                        })
                    });
                    
                    fetch('/api/farm_map').then(r => r.json()).then(renderMarkers);

                } catch (error) {
                    console.error("Error en inferencia:", error);
                    UI.upload.list.innerHTML = 'Error en motor matemático. Revisa consola.';
                }
            };
        };
        reader.readAsDataURL(file);
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.chart));
    });

    UI.charts.uvBackBtn.addEventListener('click', () => {
        UI.charts.uvDetail.classList.add('hidden');
        document.getElementById('uv-list-view').classList.remove('hidden');
    });

    initMap();
});
