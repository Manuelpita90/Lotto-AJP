// ==========================================
// 0. CONFIGURACIÓN FIREBASE Y LÓGICA (Migrado de main.js)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, query, where, orderBy, limit, Timestamp, deleteDoc, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAXYQ1Wh-vmuppQa-sVubU6uFhMA0NB-o0",
    authDomain: "lotto-ajp.firebaseapp.com",
    projectId: "lotto-ajp",
    storageBucket: "lotto-ajp.firebasestorage.app",
    messagingSenderId: "649741240897",
    appId: "1:649741240897:web:223a05b80857f8bfc654c0"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const sorteosRef = collection(db, "sorteos");

// Helper para obtener fecha local en formato YYYY-MM-DD
const getFechaLocal = (d = new Date()) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Helper para convertir fecha/hora string a Timestamp
const getTimestamp = (fecha, hora) => {
    return new Date(`${fecha} ${hora}`);
};

// Función para eliminar registros antiguos
async function limpiarDatosAntiguos() {
    try {
        const fechaLimite = new Date();
        fechaLimite.setMonth(fechaLimite.getMonth() - 3);
        const fechaLimiteStr = getFechaLocal(fechaLimite);

        const q = query(sorteosRef, where("fecha", "<", fechaLimiteStr));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const promises = snapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(promises);
        }
    } catch (e) { console.error("Error limpieza:", e); }
}

// --- FUNCIONES DE DATOS (Reemplazan a ipcRenderer) ---

async function getLastResult() {
    try {
        const q = query(sorteosRef, orderBy("timestamp", "desc"), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        return snapshot.docs[0].data();
    } catch (e) { console.error(e); return null; }
}

async function getResultsToday() {
    try {
        const fechaHoy = getFechaLocal();
        // OPTIMIZACIÓN: Quitamos orderBy de la query para evitar error de "Missing Index" en móviles
        const q = query(sorteosRef, where("fecha", "==", fechaHoy));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => doc.data());
        // Ordenamos en memoria (Ascendente)
        return data.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
    } catch (e) { console.error(e); return []; }
}

async function getStrategies() {
    const strategies = { volatil: [], equilibrio: [], estable: [] };
    const getTopForDays = async (days) => {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateStr = getFechaLocal(dateLimit);

        const q = query(sorteosRef, where("fecha", ">=", dateStr));
        const snapshot = await getDocs(q);
        const counts = {};
        let total = 0;
        snapshot.forEach(doc => {
            const animal = doc.data().animal;
            counts[animal] = (counts[animal] || 0) + 1;
            total++;
        });
        if (total === 0) return [];
        const sorted = Object.entries(counts)
            .map(([animal, count]) => ({ animal, total: count }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 3);
        sorted.forEach(r => { r.porcentaje = ((r.total / total) * 100).toFixed(1); });
        return sorted;
    };
    try {
        const [volatil, equilibrio, estable] = await Promise.all([getTopForDays(3), getTopForDays(7), getTopForDays(14)]);
        return { volatil, equilibrio, estable };
    } catch (e) { return strategies; }
}

async function syncLotto() {
    try {
        const fechaHoy = getFechaLocal();
        const params = new URLSearchParams();
        params.append('option', 'XzlPR2tleGRub1ZBSXlWdVJLbzJfZyRJZTd5TXZRb0VvRFRYQnZodm1YVXprMDlKaWlwY2p0VjZHWnZvYTh5ak9lZ2ZWOEdWckN3eDU0ejRyQ1E1TnhL');
        params.append('loteria', 'animalitos');
        params.append('fecha', fechaHoy);

        // NOTA: Usamos un proxy CORS para evitar el error "Failed to fetch" en móviles
        const targetUrl = 'https://www.lottoactivo.com/core/process.php';
        // Usamos corsproxy.io que soporta POST y reenvío de cabeceras
        const response = await fetch('https://corsproxy.io/?' + encodeURIComponent(targetUrl), {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
        });
        if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
        const data = await response.json();
        let guardados = 0;
        let ultimoAnimal = "";
        if (data.datos && Array.isArray(data.datos)) {
            const lottoActivo = data.datos.find(d => d.name && d.name.toLowerCase().includes('lotto activo'));
            if (lottoActivo && lottoActivo.resultados) {
                // OPTIMIZACIÓN: Cargar lo que ya existe hoy para comparar en memoria y evitar duplicados
                // Esto evita problemas de índices compuestos y reduce lecturas a la base de datos
                const qHoy = query(sorteosRef, where("fecha", "==", fechaHoy));
                const snapshotHoy = await getDocs(qHoy);
                const horasRegistradas = new Set();
                snapshotHoy.forEach(doc => horasRegistradas.add(doc.data().hora));

                for (const res of lottoActivo.resultados) {
                    // Si la hora ya existe en memoria, saltamos
                    if (horasRegistradas.has(res.time_s)) continue;

                    const animalNombre = res.name_animal.charAt(0).toUpperCase() + res.name_animal.slice(1).toLowerCase();

                    await addDoc(sorteosRef, {
                        fecha: fechaHoy, hora: res.time_s, numero: res.number_animal, animal: animalNombre,
                        timestamp: Timestamp.fromDate(getTimestamp(fechaHoy, res.time_s))
                    });
                    horasRegistradas.add(res.time_s); // Evitar duplicados en la misma respuesta
                    guardados++;
                    ultimoAnimal = animalNombre;
                }
            }
        }
        if (guardados > 0) limpiarDatosAntiguos();
        return { success: true, count: guardados, fecha: fechaHoy, ultimoAnimal };
    } catch (error) { throw new Error(error.message); }
}

async function addResult(data) {
    const q = query(sorteosRef, where("fecha", "==", data.fecha), where("hora", "==", data.hora));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) throw new Error("Ya existe un resultado registrado.");
    const docRef = await addDoc(sorteosRef, {
        fecha: data.fecha, hora: data.hora, numero: data.numero, animal: data.animal,
        timestamp: Timestamp.fromDate(getTimestamp(data.fecha, data.hora))
    });
    limpiarDatosAntiguos();
    return docRef.id;
}

async function getAnimalHistory({ animal, dias }) {
    try {
        const diasSafe = parseInt(dias) || 0;
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - diasSafe);
        // Nota: dateStr ya no se usa en la query optimizada, pero si se necesitara: getFechaLocal(dateLimit)

        // OPTIMIZACIÓN: Simplificamos la query para evitar índices compuestos complejos
        const q = query(sorteosRef, where("animal", "==", animal));
        const snapshot = await getDocs(q);

        let data = snapshot.docs.map(doc => doc.data());

        // Filtramos por fecha y ordenamos en memoria (Descendente)
        return data
            .filter(item => item.timestamp && item.timestamp.toDate() >= dateLimit)
            .sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));

    } catch (e) { return []; }
}

// ==========================================
// LÓGICA PWA (Instalación)
// ==========================================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'block';
});

window.instalarPWA = async () => {
    const banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'none';

    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Resultado instalación: ${outcome}`);
        deferredPrompt = null;
    }
};

window.cerrarBannerInstall = () => {
    document.getElementById('install-banner').style.display = 'none';
};

window.addEventListener('appinstalled', () => {
    console.log('PWA instalada');
    document.getElementById('install-banner').style.display = 'none';
});

// Escuchar mensajes del Service Worker (clic en notificación)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.action === 'verHistorial' && event.data.animal) {
            if (window.verHistorial) window.verHistorial(event.data.animal, 30);
        }
    });
}

// ==========================================
// 1. FUNCIONES DE ESTADO (WiFi y Brillo)
// ==========================================

function actualizarEstadoRed() {
    const wifi = document.getElementById('icon-wifi');
    if (navigator.onLine) {
        wifi.className = 'fas fa-wifi wifi-online';
        wifi.title = 'Conectado a Internet';
    } else {
        wifi.className = 'fas fa-wifi wifi-offline';
        wifi.title = 'Sin conexión a Internet';
    }
}

window.addEventListener('online', () => {
    actualizarEstadoRed();
    // Intentar sincronizar automáticamente al recuperar conexión
    syncLotto().then(res => {
        if (res && res.count > 0) {
            reproducirNotificacion(res.count, res.ultimoAnimal);
            ultimoSorteoId = getSorteoId(new Date());
            cargarTodo().then(() => resaltarHoraActualizacion());
        }
    }).catch(e => console.error("Error auto-sync al reconectar:", e));
});
window.addEventListener('offline', actualizarEstadoRed);

let timerHoraActualizada = null;

function resaltarHoraActualizacion() {
    const lblHora = document.getElementById('lbl-ultima-hora');
    lblHora.classList.add('hora-actualizada');

    if (timerHoraActualizada) clearTimeout(timerHoraActualizada);

    timerHoraActualizada = setTimeout(() => {
        lblHora.classList.remove('hora-actualizada');
    }, 1200000);
}

function actualizarFechaCabecera() {
    const d = new Date();
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const fechaStr = `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]} del ${d.getFullYear()}`;

    let hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = d.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strMinutes = minutes < 10 ? '0' + minutes : minutes;
    const strSeconds = seconds < 10 ? '0' + seconds : seconds;

    const el = document.getElementById('header-date');
    if (el) el.innerHTML = `${fechaStr}<div style="font-family: monospace; font-size: 1.4em; font-weight: 700; margin-top: 2px;">${hours}:${strMinutes}<span style="opacity: 0.6;">:${strSeconds}</span> ${ampm}</div>`;
}

function reproducirNotificacion(cantidad = 0, animal = "") {
    const audio = new Audio('notification.mp3');
    audio.play().catch(e => console.log("Audio no reproducido (interacción requerida o archivo faltante):", e));

    // Notificación Visual (Push Local)
    if ("Notification" in window && Notification.permission === "granted") {
        let msg = cantidad > 0 ? `¡Han salido ${cantidad} nuevos resultados!` : "¡Nuevos resultados disponibles!";

        if (cantidad === 1 && animal) {
            msg = `¡Salió el ${animal}!`;
        } else if (cantidad > 1 && animal) {
            msg = `¡Han salido ${cantidad} nuevos resultados! (Último: ${animal})`;
        }

        const options = {
            body: msg,
            icon: 'loteria.png',
            vibrate: [200, 100, 200],
            tag: 'lotto-update',
            data: { animal: animal } // Guardamos el animal para usarlo al hacer clic
        };

        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(reg => reg.showNotification("Lotto-AJP", options));
        } else {
            const notif = new Notification("Lotto-AJP", options);
            notif.onclick = () => {
                window.focus();
                if (animal && window.verHistorial) window.verHistorial(animal, 30);
                notif.close();
            };
        }
    }
}

// ==========================================
// 2. FUNCIONES GLOBALES DE LA INTERFAZ (Modales y Menús)
// ==========================================

window.toggleMenu = (event) => {
    if (event) event.stopPropagation();
    document.getElementById('dropdown-menu').classList.toggle('hidden');
};

window.cerrarMenu = () => {
    const menu = document.getElementById('dropdown-menu');
    if (menu && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
    }
};

window.abrirModalManual = () => {
    cerrarMenu();
    const d = new Date();
    document.getElementById('in-fecha').value = getFechaLocal(d);
    document.getElementById('modal-manual').classList.remove('hidden');
};

window.cerrarModalManual = () => {
    document.getElementById('modal-manual').classList.add('hidden');
};

window.abrirModalResultados = () => {
    cerrarMenu();
    document.getElementById('modal-resultados').classList.remove('hidden');
};

window.cerrarModalResultados = () => {
    document.getElementById('modal-resultados').classList.add('hidden');
};

window.abrirModalAcerca = () => {
    cerrarMenu();
    document.getElementById('modal-acerca').classList.remove('hidden');
};

window.cerrarModalAcerca = () => {
    document.getElementById('modal-acerca').classList.add('hidden');
};

window.abrirModalDatabase = async () => {
    cerrarMenu();
    const modal = document.getElementById('modal-database');
    const content = document.getElementById('database-count-content');
    modal.classList.remove('hidden');
    content.innerHTML = '<div style="padding:20px;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--acento);"></i><div style="margin-top:10px; color: var(--text-muted);">Consultando nube...</div></div>';

    try {
        const snapshot = await getCountFromServer(sorteosRef);
        const count = snapshot.data().count;

        // Consultar el registro más antiguo para verificar la retención de datos
        const qOldest = query(sorteosRef, orderBy("timestamp", "asc"), limit(1));
        const snapshotOldest = await getDocs(qOldest);
        let fechaInicio = "---";

        if (!snapshotOldest.empty) {
            fechaInicio = snapshotOldest.docs[0].data().fecha;
        }

        content.innerHTML = `
            <div style="font-size: 3.5rem; font-weight: 800; color: var(--acento); text-shadow: 0 0 20px rgba(0, 242, 195, 0.3); line-height: 1;">${count}</div>
            <div style="color: var(--text-muted); font-size: 0.9rem; margin-top: 5px;">Registros Totales</div>
            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 0.8rem; color: var(--text-muted);">Datos desde:</div>
                <div style="font-size: 1.1rem; font-weight: 600; color: #fff;">${fechaInicio}</div>
            </div>
            <div style="font-size: 0.75rem; color: #555; margin-top: 15px;">Almacenados en Google Firestore</div>
        `;
    } catch (e) {
        content.innerHTML = `<div style="color: var(--volatil); padding: 10px;">Error al consultar: ${e.message}</div>`;
    }
};

window.cerrarModalDatabase = () => {
    document.getElementById('modal-database').classList.add('hidden');
};

window.descargarRespaldoJSON = async () => {
    const btn = document.getElementById('btn-download-json');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';

    try {
        const q = query(sorteosRef, orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);

        const data = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                fecha: d.fecha,
                hora: d.hora,
                numero: d.numero,
                animal: d.animal
            };
        });

        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `lotto_ajp_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (e) {
        mostrarMensaje('Error', 'No se pudo descargar el respaldo: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
    }
};

window.importarRespaldoJSON = () => {
    document.getElementById('file-import-json').click();
};

window.compartirWhatsapp = async () => {
    try {
        const estrategias = await getStrategies();
        const volatil = estrategias.volatil || [];
        const ultimo = await getLastResult();

        if (volatil.length === 0) {
            mostrarMensaje('Aviso', 'No hay datos de alta volatilidad para compartir.');
            return;
        }

        const horaActual = new Date().getHours();
        let saludo = "Buenos días";
        if (horaActual >= 12 && horaActual < 18) saludo = "Buenas tardes";
        else if (horaActual >= 18) saludo = "Buenas noches";

        let texto = `${saludo} 👋\n*🚀 Pronósticos Lotto-AJP - Alta Volatilidad*\n`;

        if (ultimo && ultimo.hora) {
            texto += `_Último sorteo: ${ultimo.hora}_\n\n`;
        } else {
            texto += "\n";
        }

        volatil.slice(0, 3).forEach((item, i) => {
            const num = NUMEROS_ANIMALES[item.animal.toUpperCase()] || '??';
            texto += `${i + 1}. ${item.animal} (${num}) - ${item.porcentaje}%\n`;
        });
        texto += "\n_Desarrollado por AJP-Logic_";

        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
        window.open(url, '_blank');
    } catch (e) {
        mostrarMensaje('Error', 'No se pudo abrir WhatsApp: ' + e.message);
    }
};

let mensajeTimer = null;

window.mostrarMensaje = (titulo, texto, duracion = 3000) => {
    if (mensajeTimer) clearTimeout(mensajeTimer);

    document.getElementById('mensaje-titulo').innerText = titulo;
    document.getElementById('mensaje-texto').innerText = texto;
    document.getElementById('modal-mensaje').classList.remove('hidden');

    if (duracion > 0) {
        mensajeTimer = setTimeout(window.cerrarModalMensaje, duracion);
    }
};

window.cerrarModalMensaje = () => {
    if (mensajeTimer) clearTimeout(mensajeTimer);
    document.getElementById('modal-mensaje').classList.add('hidden');
};

window.verHistorial = async (animal, dias) => {
    try {
        const titulo = document.getElementById('historial-titulo');
        titulo.innerHTML = `<span><i class="fas fa-history" style="color:var(--acento); margin-right:8px;"></i> ${animal} (${dias} días)</span>
                            <button onclick="cerrarModalHistorial()" style="background:none; border:none; color:#8ba1b5; cursor:pointer; font-size:1.2rem;"><i class="fas fa-times"></i></button>`;

        const resultados = await getAnimalHistory({ animal, dias });
        const container = document.getElementById('container-historial-animal');

        if (!resultados || resultados.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:#8ba1b5; font-style:italic;">No se encontraron registros.</div>`;
        } else {
            const num = NUMEROS_ANIMALES[(animal || '').toUpperCase()] || '??';
            container.innerHTML = resultados.map(r => {
                const [y, m, d] = r.fecha.split('-').map(Number);
                const fechaObj = new Date(y, m - 1, d);
                const diaSemana = fechaObj.toLocaleDateString('es-ES', { weekday: 'long' });
                const fechaFormateada = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
                return `
                <div class="result-item" style="justify-content: flex-start; gap: 20px;">
                    <img src="img/animales/${num}.png" style="width:24px; height:24px; border-radius:50%;" onerror="this.style.display='none'">
                    <span style="color:#fff; font-size:0.95rem; font-weight:600; text-transform: capitalize;"><i class="far fa-calendar-alt"></i> ${diaSemana}, ${fechaFormateada}, ${r.hora}</span>
                </div>
            `}).join('');
        }
        document.getElementById('modal-historial').classList.remove('hidden');
    } catch (e) {
        alert("Error cargando historial: " + e.message);
    }
};

window.cerrarModalHistorial = () => {
    document.getElementById('modal-historial').classList.add('hidden');
};

window.verDetalleAciertos = () => {
    if (!listaAciertos || listaAciertos.length === 0) {
        mostrarMensaje('Sin Aciertos', 'Aún no hay aciertos registrados hoy.');
        return;
    }

    const container = document.getElementById('container-lista-aciertos');
    container.innerHTML = listaAciertos.map(r => {
        const num = NUMEROS_ANIMALES[(r.animal || '').toUpperCase()] || '??';

        // Generar etiquetas (badges) para cada estrategia que acertó
        const badges = (r.estrategias || []).map(e => {
            let colorVar = '--text-muted';
            if (e === 'Volátil') colorVar = '--volatil';
            if (e === 'Equilibrio') colorVar = '--equilibrio';
            if (e === 'Estable') colorVar = '--estable';
            return `<span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); color: var(${colorVar}); border: 1px solid var(${colorVar}); margin-right: 4px; display:inline-block; margin-top:2px;">${e}</span>`;
        }).join('');

        return `
            <div class="result-item" style="justify-content: flex-start; gap: 20px;">
                <img src="img/animales/${num}.png" style="width:35px; height:35px; border-radius:50%;" onerror="this.style.display='none'">
                <div>
                    <div style="color:#fff; font-weight:bold; font-size: 1rem;">${r.animal}</div>
                    <div style="color:var(--acento); font-size:0.85rem;"><i class="far fa-clock"></i> ${r.hora}</div>
                    <div style="margin-top: 4px;">${badges}</div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('modal-aciertos').classList.remove('hidden');
};

window.cerrarModalAciertos = () => {
    document.getElementById('modal-aciertos').classList.add('hidden');
};

document.addEventListener('click', (event) => {
    const menu = document.getElementById('dropdown-menu');
    const btn = document.getElementById('btn-toggle-menu');
    if (menu && btn && !menu.contains(event.target) && !btn.contains(event.target)) {
        cerrarMenu();
    }
});

// ==========================================
// 3. CONEXIÓN CON EL BACKEND (ELECTRON)
// ==========================================

const NUMEROS_ANIMALES = {
    'DELFIN': '0', 'DELFÍN': '0', 'BALLENA': '00', 'CARNERO': '1', 'TORO': '2', 'CIEMPIES': '3', 'CIEMPIÉS': '3', 'ALACRAN': '4', 'ALACRÁN': '4',
    'LEON': '5', 'LEÓN': '5', 'RANA': '6', 'PERICO': '7', 'RATON': '8', 'RATÓN': '8', 'AGUILA': '9', 'ÁGUILA': '9', 'TIGRE': '10',
    'GATO': '11', 'CABALLO': '12', 'MONO': '13', 'PALOMA': '14', 'ZORRO': '15', 'OSO': '16',
    'PAVO': '17', 'BURRO': '18', 'CHIVO': '19', 'COCHINO': '20', 'GALLO': '21', 'CAMELLO': '22',
    'CEBRA': '23', 'IGUANA': '24', 'GALLINA': '25', 'VACA': '26', 'PERRO': '27', 'ZAMURO': '28',
    'ELEFANTE': '29', 'CAIMAN': '30', 'CAIMÁN': '30', 'LAPA': '31', 'ARDILLA': '32', 'PESCADO': '33', 'VENADO': '34',
    'JIRAFA': '35', 'CULEBRA': '36'
};

window.onload = async () => {
    actualizarEstadoRed();
    actualizarFechaCabecera();
    setInterval(actualizarFechaCabecera, 1000);
    actualizarAciertos(0); // Estado inicial: 0 aciertos (Rojo)
    inicializarCombos();

    await cargarTodo();

    // Ocultar Splash Screen con transición suave
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => splash.style.display = 'none', 500);
    }

    iniciarAutoSync();

    // Configurar listener para importación de JSON
    const fileInput = document.getElementById('file-import-json');
    if (fileInput) {
        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            event.target.value = ''; // Limpiar para permitir seleccionar el mismo archivo de nuevo

            if (!confirm("¿Deseas restaurar los datos desde este archivo? Se agregarán solo los registros que falten en la nube.")) {
                return;
            }

            const btn = document.getElementById('btn-import-json');
            const progressContainer = document.getElementById('import-progress-container');
            const progressBar = document.getElementById('import-progress-bar');
            const progressText = document.getElementById('import-progress-text');

            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restaurando...';
            btn.style.opacity = '0.7';
            btn.style.pointerEvents = 'none';

            // Mostrar barra de progreso
            if (progressContainer) progressContainer.style.display = 'block';
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.innerText = '0%';

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!Array.isArray(data)) throw new Error("Formato de archivo inválido.");

                let agregados = 0;
                const total = data.length;

                // OPTIMIZACIÓN: Procesar en lotes paralelos para reducir el tiempo de 1 hora a ~5 minutos
                const batchSize = 50;

                for (let i = 0; i < total; i += batchSize) {
                    const chunk = data.slice(i, i + batchSize);

                    await Promise.all(chunk.map(async (item) => {
                        if (item.fecha && item.hora && item.animal && item.numero) {
                            const q = query(sorteosRef, where("fecha", "==", item.fecha), where("hora", "==", item.hora));
                            const snapshot = await getDocs(q);
                            if (snapshot.empty) {
                                await addDoc(sorteosRef, {
                                    fecha: item.fecha,
                                    hora: item.hora,
                                    numero: item.numero,
                                    animal: item.animal,
                                    timestamp: Timestamp.fromDate(getTimestamp(item.fecha, item.hora))
                                });
                                agregados++;
                            }
                        }
                    }));

                    // Actualizar progreso visual
                    if (progressBar && progressText) {
                        const current = Math.min(i + batchSize, total);
                        const percent = Math.round((current / total) * 100);
                        progressBar.style.width = `${percent}%`;
                        progressText.innerText = `${percent}% (${current}/${total})`;
                    }
                }

                if (agregados > 0) limpiarDatosAntiguos(); // Limpieza única al final

                mostrarMensaje('Restauración', `Proceso finalizado. Se recuperaron ${agregados} registros nuevos.`);
                abrirModalDatabase(); // Actualizar contador
                cargarTodo(); // Actualizar interfaz
            } catch (e) {
                mostrarMensaje('Error', 'Fallo al importar: ' + e.message);
            } finally {
                btn.innerHTML = originalText;
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
                if (progressContainer) progressContainer.style.display = 'none';
            }
        });
    }
};

async function cargarTodo() {
    await cargarUltimoSorteo();
    await cargarResultadosHoy();
    await cargarEstrategias();
    await calcularYMostrarAciertos();
}

function inicializarCombos() {
    const selectAnimal = document.getElementById('in-animal');
    if (!selectAnimal) return;

    const mapaUnico = {};
    Object.entries(NUMEROS_ANIMALES).forEach(([nombre, numero]) => {
        if (!mapaUnico[numero] || nombre.length >= mapaUnico[numero].length && /[áéíóúñ]/.test(nombre.toLowerCase())) {
            mapaUnico[numero] = nombre;
        }
    });

    const lista = Object.entries(mapaUnico).map(([num, nombre]) => ({ num, nombre }));
    lista.sort((a, b) => (a.num === '00' ? -1 : b.num === '00' ? 1 : parseInt(a.num) - parseInt(b.num)));
    selectAnimal.innerHTML = lista.map(i => `<option value="${i.nombre}">${i.num} - ${i.nombre}</option>`).join('');
}

// ==========================================
// 4. FUNCIONES DE DIBUJADO DE DATOS
// ==========================================

async function cargarUltimoSorteo() {
    try {
        const ultimo = await getLastResult();
        if (ultimo) {
            const num = NUMEROS_ANIMALES[(ultimo.animal || '').toUpperCase()] || '??';
            document.getElementById('lbl-ultimo-numero').innerHTML = `
                <img src="img/animales/${num}.png" style="width:45px; height:45px; margin-right:10px; border-radius:10px; box-shadow: 0 4px 10px rgba(0, 242, 195, 0.3);" onerror="this.style.display='none'">
                ${num}
            `;
            document.getElementById('lbl-ultimo-animal').innerText = ultimo.animal;
            document.getElementById('lbl-ultima-hora').innerText = `Hoy, ${ultimo.hora}`;
        } else {
            document.getElementById('lbl-ultimo-animal').innerText = "Sin registros. Sincroniza o agrega manual.";
        }
    } catch (e) {
        alert("Error cargando el último sorteo: " + e.message);
    }
}

async function cargarResultadosHoy() {
    const container = document.getElementById('container-resultados-hoy');

    // Mostrar spinner antes de iniciar la carga
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.minHeight = '150px';
    container.innerHTML = `<div style="text-align:center; color:var(--acento);"><i class="fas fa-spinner fa-spin" style="font-size: 2rem;"></i><div style="margin-top:10px; font-size:0.9rem; color:#8ba1b5;">Cargando...</div></div>`;

    try {
        const resultados = await getResultsToday();

        // Restaurar estilos base
        container.style.minHeight = '';
        container.style.alignItems = '';
        container.style.justifyContent = '';

        if (!resultados || resultados.length === 0) {
            container.style.display = 'block';
            container.innerHTML = `<div style="text-align:center; padding:20px; color:#8ba1b5; font-style:italic;">Aún no hay sorteos registrados hoy.</div>`;
            return;
        }

        container.style.display = 'grid'; // Aseguramos el layout de cuadricula (Grid)

        // Formato Escritorio: Tarjetas grandes agrupadas en 3 columnas
        container.innerHTML = resultados.map(r => {
            const num = NUMEROS_ANIMALES[(r.animal || '').toUpperCase()] || '??';
            return `
                <div class="grid-item">
                    <span style="color:#8ba1b5; font-size:0.85rem; font-weight:600;"><i class="far fa-clock"></i> ${r.hora}</span>
                    <div style="display:flex; align-items:center; justify-content:center; gap:10px; width: 100%;">
                        <span style="color:#00f2c3; font-weight:bold; font-size:1.6rem;">${num}</span>
                        <img src="img/animales/${num}.png" style="width:40px; height:40px; border-radius:50%; box-shadow: 0 2px 5px rgba(0,0,0,0.5);" onerror="this.style.display='none'">
                    </div>
                    <span style="font-weight:bold; font-size:1.1rem; text-align:center;">${r.animal}</span>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error("Error en resultados de hoy:", e);
    }
}

async function cargarEstrategias() {
    try {
        const strats = await getStrategies();

        const renderColumn = (containerId, dataArray, dias) => {
            const container = document.getElementById(containerId);
            if (!dataArray || dataArray.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding: 20px; color:#8ba1b5;">Esperando datos...</div>';
                return;
            }

            container.innerHTML = dataArray.map(item => {
                if (!item.animal) return '';
                const num = NUMEROS_ANIMALES[item.animal.toUpperCase()] || '??';
                const safeAnimal = item.animal.replace(/'/g, "\\'");
                return `
                    <div class="animal-card" onclick="verHistorial('${safeAnimal}', ${dias})">
                        <img src="img/animales/${num}.png" style="width:45px; height:45px; border-radius:10px; background:rgba(255,255,255,0.05); padding:2px;" onerror="this.style.display='none'">
                        <div class="animal-number" style="width:auto; margin-left:5px; margin-right:5px;">${num}</div>
                        <div class="animal-info">
                            <h4>${item.animal}</h4>
                            <p>${item.total} salidas</p>
                        </div>
                        <div class="animal-pct">${item.porcentaje}%</div>
                    </div>
                `;
            }).join('');
        };

        // Función auxiliar para obtener fecha formateada
        const getStartDateStr = (days) => {
            const d = new Date();
            d.setDate(d.getDate() - days);
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        };

        renderColumn('container-volatil', strats.volatil, 3);
        if (document.getElementById('info-volatil')) document.getElementById('info-volatil').innerHTML = `<i class="far fa-calendar-check"></i> Datos desde: ${getStartDateStr(3)}`;

        renderColumn('container-equilibrio', strats.equilibrio, 7);
        if (document.getElementById('info-equilibrio')) document.getElementById('info-equilibrio').innerHTML = `<i class="far fa-calendar-check"></i> Datos desde: ${getStartDateStr(7)}`;

        renderColumn('container-estable', strats.estable, 14);
        if (document.getElementById('info-estable')) document.getElementById('info-estable').innerHTML = `<i class="far fa-calendar-check"></i> Datos desde: ${getStartDateStr(14)}`;

    } catch (e) {
        alert("Error cargando estrategias: " + e.message);
    }
}

let listaAciertos = [];
let aciertosTimer = null;
let lastAciertosCount = 0;
let blinkTimer = null;

async function calcularYMostrarAciertos() {
    try {
        const resultados = await getResultsToday();
        const estrategias = await getStrategies();

        const estrategiasMap = {};

        // Mapeamos qué animal pertenece a qué estrategia
        const procesar = (lista, nombre) => {
            if (Array.isArray(lista)) {
                lista.forEach(item => {
                    if (item.animal) {
                        const key = item.animal.toUpperCase();
                        if (!estrategiasMap[key]) estrategiasMap[key] = [];
                        if (!estrategiasMap[key].includes(nombre)) estrategiasMap[key].push(nombre);
                    }
                });
            }
        };

        procesar(estrategias.volatil, 'Volátil');
        procesar(estrategias.equilibrio, 'Equilibrio');
        procesar(estrategias.estable, 'Estable');

        let aciertos = 0;
        listaAciertos = [];
        if (resultados && resultados.length > 0) {
            resultados.forEach(r => {
                const key = (r.animal || '').toUpperCase();
                if (key && estrategiasMap[key]) {
                    aciertos++;
                    // Guardamos el resultado junto con las estrategias que lo pronosticaron
                    listaAciertos.push({ ...r, estrategias: estrategiasMap[key] });
                }
            });
        }

        actualizarAciertos(aciertos);
    } catch (e) {
        console.error("Error calculando aciertos:", e);
    }
}

function actualizarAciertos(cantidad) {
    const box = document.getElementById('box-aciertos');
    const lbl = document.getElementById('lbl-aciertos-count');

    if (!box || !lbl) return;

    lbl.innerText = `${cantidad} Aciertos`;

    // Si hay nuevos aciertos (cantidad aumentó), activar parpadeo por 3 segundos
    if (cantidad > lastAciertosCount) {
        if (blinkTimer) clearTimeout(blinkTimer);
        box.classList.add('blink-anim');
        blinkTimer = setTimeout(() => {
            box.classList.remove('blink-anim');
        }, 3000);
    }
    lastAciertosCount = cantidad;

    if (aciertosTimer) clearTimeout(aciertosTimer);

    let tiempoEspera = 1200000; // Por defecto 20 minutos

    if (cantidad > 0) {
        box.style.borderColor = 'var(--acento)'; // Verde (Color de acento)
        box.style.boxShadow = '0 0 15px rgba(0, 242, 195, 0.15)';
        lbl.style.color = 'var(--acento)';
        tiempoEspera = 1200000; // 20 minutos si hay acierto
    } else {
        box.style.borderColor = 'var(--volatil)'; // Rojo (Color volátil)
        box.style.boxShadow = 'none';
        lbl.style.color = '#fff';
        tiempoEspera = 300000; // 5 minutos si no hubo acierto
    }

    // Volver al color original (neutro) después del tiempo establecido
    aciertosTimer = setTimeout(() => {
        box.style.borderColor = 'var(--border-color)';
        box.style.boxShadow = 'none';
        lbl.style.color = '#fff';
    }, tiempoEspera);
}

// ==========================================
// 5. ACCIONES DE BASE DE DATOS Y RED
// ==========================================

let ultimoSorteoId = "";

function getSorteoId(dateObj) {
    return `${dateObj.getFullYear()}-${dateObj.getMonth()}-${dateObj.getDate()}-${dateObj.getHours()}`;
}

window.sincronizarDatos = async () => {
    cerrarMenu();

    // Solicitar permiso para notificaciones si aún no se tiene (requiere interacción del usuario)
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    const menuSync = document.getElementById('menu-sync');
    const originalText = menuSync.innerHTML;
    menuSync.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando...';
    menuSync.style.pointerEvents = 'none';

    try {
        const res = await syncLotto();
        if (res.count > 0) {
            reproducirNotificacion(res.count, res.ultimoAnimal);
            ultimoSorteoId = getSorteoId(new Date());
            await cargarTodo();
            resaltarHoraActualizacion();
            mostrarMensaje('✅ Sincronización Exitosa', `Se agregaron ${res.count} nuevos resultados.`);
        } else {
            mostrarMensaje('ℹ️ Sin Novedades', 'Ya tienes todos los resultados actualizados.');
        }
    } catch (e) {
        mostrarMensaje('❌ Error', 'Error al sincronizar: ' + e);
    } finally {
        menuSync.innerHTML = originalText;
        menuSync.style.pointerEvents = 'auto';
    }
};

function iniciarAutoSync() {
    let ultimoMinuto = -1;
    setInterval(() => {
        const now = new Date();
        const min = now.getMinutes();
        const currentId = getSorteoId(now);

        if (currentId === ultimoSorteoId) return;

        if ([0, 5, 10, 15, 20].includes(min) && min !== ultimoMinuto) {
            ultimoMinuto = min;
            syncLotto().then(res => {
                if (res && res.count > 0) {
                    reproducirNotificacion(res.count, res.ultimoAnimal);
                    ultimoSorteoId = currentId;
                    cargarTodo().then(() => resaltarHoraActualizacion());
                }
            }).catch(e => console.error("Error en auto-sync:", e));
        }
    }, 10000);
}

window.guardarManual = async () => {
    const fecha = document.getElementById('in-fecha').value;
    const hora = document.getElementById('in-hora').value;
    const animal = document.getElementById('in-animal').value;

    if (!NUMEROS_ANIMALES.hasOwnProperty(animal.toUpperCase())) {
        mostrarMensaje("❌ Error", "El animal seleccionado no es válido.");
        return;
    }
    const numero = NUMEROS_ANIMALES[animal.toUpperCase()];

    try {
        await addResult({ fecha, hora, animal, numero });
        cerrarModalManual();

        const now = new Date();
        const currentHour = now.getHours();
        const horaManualMatch = hora.match(/(\d+):(\d+)\s+(AM|PM)/);
        if (horaManualMatch) {
            let h = parseInt(horaManualMatch[1]);
            if (h !== 12 && horaManualMatch[3] === 'PM') h += 12;
            if (h === 12 && horaManualMatch[3] === 'AM') h = 0;
            if (h === currentHour) ultimoSorteoId = getSorteoId(now);
        }

        await cargarTodo();
        resaltarHoraActualizacion();
        mostrarMensaje("✅ Éxito", "Sorteo guardado correctamente.");
    } catch (e) {
        mostrarMensaje("❌ Error", (e.message || e));
    }
};