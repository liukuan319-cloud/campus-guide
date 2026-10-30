(() => {
    'use strict';
    const searchBox = document.getElementById('search-box');
    const searchArea = document.getElementById('search-area');
    const historyPanel = document.getElementById('search-history');
    const infoTitle = document.getElementById('info-title');
    const infoDesc = document.getElementById('info-desc');
    const infoCategory = document.getElementById('info-category');
    const infoCard = document.querySelector('.info-card');
    const infoClose = document.getElementById('info-close');
    const navMenu = document.querySelector('.nav-menu');
    const menu = document.getElementById('location-menu');
    const container = document.getElementById('panorama-container');
    const overlay = document.getElementById('scene-loading');
    const preview = document.getElementById('loading-preview');
    const message = document.getElementById('loading-message');
    const progress = document.getElementById('loading-progress');
    const percent = document.getElementById('loading-percent');
    const retry = document.getElementById('loading-retry');
    const panoramaModeButton = document.getElementById('panorama-mode');
    const aerialModeButton = document.getElementById('aerial-mode');
    const aerialOptions = document.getElementById('aerial-options');
    const aerial2d = document.getElementById('aerial-2d');
    const aerial3d = document.getElementById('aerial-3d');
    const aerialNotice = document.getElementById('aerial-notice');
    const returnPanorama = document.getElementById('return-panorama');
    const historyKey = 'campusSearchHistory';
    const locations = new Map();
    const names = new Map();
    const cache = new Map();
    let searchHistory = [];
    let viewer;
    let currentId;
    let requestedId;
    let currentObjectUrl;
    let sequence = 0;
    let foreground;
    let preloadController;
    let idleHandle;
    let renderTail = Promise.resolve();
    let configuration;
    let overviewMode = false;
    let normalLocationId;
    let selectedLocationId;
    let selectedMarker;
    let requestedInfo = false;

    navMenu?.addEventListener('click', event => {
        if (window.matchMedia('(max-width: 720px)').matches && !event.target.closest('.dropdown')) {
            navMenu.classList.toggle('is-open');
        }
    });
    document.addEventListener('pointerdown', event => {
        if (navMenu && !navMenu.contains(event.target)) navMenu.classList.remove('is-open');
    });

    function showDescription(location) {
        infoTitle.textContent = location.name;
        infoDesc.textContent = location.description;
        if (infoCategory) infoCategory.textContent = location.category || '校园导览';
        infoCard.dataset.locationId = location.id;
        infoCard.hidden = false;
    }

    function clearHotspotSelection() {
        selectedMarker?.classList.remove('is-selected');
        selectedMarker?.setAttribute('aria-expanded', 'false');
        selectedMarker?.parentElement.classList.remove('is-active');
        selectedMarker = undefined;
        selectedLocationId = undefined;
    }

    function selectHotspot(id, marker) {
        const location = locations.get(id);
        if (!location) return;
        clearHotspotSelection();
        selectedLocationId = id;
        selectedMarker = marker;
        marker.classList.add('is-selected');
        marker.setAttribute('aria-expanded', 'true');
        const anchor = marker.parentElement;
        anchor.classList.add('is-active');
    }

    function closeInfoCard() {
        infoCard.hidden = false;
        infoClose.hidden = true;
        infoCard.classList.remove('is-open');
    }

    infoClose.addEventListener('click', () => {
        infoClose.blur();
        closeInfoCard();
    });
    document.addEventListener('pointerdown', event => {
        if (selectedMarker && !selectedMarker.parentElement.contains(event.target)) clearHotspotSelection();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && selectedMarker) {
            const marker = selectedMarker;
            clearHotspotSelection();
            marker.focus({ preventScroll: true });
        }
    });

    function closeAerialOptions() {
        aerialOptions.hidden = true;
        aerialNotice.hidden = true;
        aerialModeButton.setAttribute('aria-expanded', 'false');
    }

    function setOverviewMode(active) {
        overviewMode = active;
        panoramaModeButton.classList.toggle('active', !active);
        aerialModeButton.classList.toggle('active', active);
        returnPanorama.hidden = !active;
        container.dataset.mode = active ? 'aerial-2d' : 'panorama';
    }

    function returnToPanorama() {
        closeAerialOptions();
        if (overviewMode) loadLocation(normalLocationId || configuration.defaultLocationId);
    }

    aerialModeButton.addEventListener('click', () => {
        const open = aerialOptions.hidden;
        aerialOptions.hidden = !open;
        aerialNotice.hidden = true;
        aerialModeButton.setAttribute('aria-expanded', String(open));
    });
    aerial2d.addEventListener('click', () => {
        closeAerialOptions();
        if (configuration) loadLocation(configuration.overviewLocationId, { overview: true });
    });
    aerial3d.addEventListener('click', () => { aerialNotice.hidden = false; });
    returnPanorama.addEventListener('click', returnToPanorama);
    panoramaModeButton.addEventListener('click', returnToPanorama);
    document.addEventListener('click', event => {
        if (!aerialOptions.contains(event.target) && !aerialModeButton.contains(event.target)) closeAerialOptions();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !aerialOptions.hidden) {
            closeAerialOptions();
            aerialModeButton.focus();
        }
    });

    try {
        const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
        if (Array.isArray(saved)) searchHistory = [...new Set(saved.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))].slice(0, 5);
    } catch (_) { /* Search remains usable if storage is unavailable. */ }

    function hideHistory() {
        historyPanel.hidden = true;
        searchBox.setAttribute('aria-expanded', 'false');
    }

    function showHistory() {
        historyPanel.replaceChildren();
        for (const name of searchHistory) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'history-item';
            button.textContent = name;
            button.addEventListener('click', () => { searchBox.value = name; searchPlace(name, { showInfo: true }); });
            historyPanel.appendChild(button);
        }
        historyPanel.hidden = searchHistory.length === 0;
        searchBox.setAttribute('aria-expanded', String(searchHistory.length > 0));
    }

    function searchPlace(name, { showInfo = false } = {}) {
        const query = name.trim();
        if (!query) { hideHistory(); return; }
        searchHistory = [query, ...searchHistory.filter(item => item !== query)].slice(0, 5);
        try { localStorage.setItem(historyKey, JSON.stringify(searchHistory)); } catch (_) { /* In-memory history still works. */ }
        hideHistory();
        const location = names.get(query);
        if (location) loadLocation(location.id, { showInfo });
    }

    searchBox.addEventListener('focus', showHistory);
    searchBox.addEventListener('click', showHistory);
    searchBox.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault(); searchPlace(searchBox.value, { showInfo: true });
        }
    });
    document.addEventListener('click', event => { if (!searchArea.contains(event.target)) hideHistory(); });

    function buildMenu(data) {
        menu.replaceChildren();
        for (const category of data.categories) {
            const section = document.createElement('section');
            section.className = 'dropdown-group';
            const heading = document.createElement('h4');
            heading.className = 'dropdown-group-title';
            heading.textContent = category;
            const buttons = document.createElement('div');
            buttons.className = 'dropdown-places';
            const entries = [...data.locations.filter(item => item.category === category),
                ...(data.pendingLocations || []).filter(item => item.category === category)]
                .sort((a, b) => a.menuOrder - b.menuOrder);
            for (const location of entries) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'dropdown-item';
                button.textContent = location.menuLabel || location.name;
                if (!location.id) {
                    button.disabled = true;
                    button.title = location.status;
                    const badge = document.createElement('span');
                    badge.className = 'dropdown-pending';
                    badge.textContent = '待确认';
                    button.appendChild(badge);
                } else {
                    button.dataset.name = location.name;
                    button.dataset.locationId = location.id;
                    button.addEventListener('click', () => {
                        searchBox.value = location.name;
                        searchPlace(location.name, { showInfo: true });
                    });
                }
                buttons.appendChild(button);
            }
            section.append(heading, buttons);
            menu.appendChild(section);
        }
        menu.setAttribute('aria-busy', 'false');
    }

    function cacheBlob(id, blob) {
        cache.delete(id);
        cache.set(id, blob);
        while (cache.size > 4) {
            const oldest = [...cache.keys()].find(key => key !== currentId && key !== requestedId);
            if (!oldest) break;
            cache.delete(oldest);
        }
    }

    function setProgress(loaded, total) {
        if (total > 0) {
            const value = Math.min(100, Math.round(loaded / total * 100));
            progress.value = value;
            percent.textContent = value + '%';
        } else {
            progress.removeAttribute('value');
            percent.textContent = loaded ? (loaded / 1000000).toFixed(2) + ' MB' : '准备加载…';
        }
    }

    // Classic scripts can load sibling files from file://. Image data is then
    // converted to the same Blob pipeline used online, without unsafe flags.
    function loadLocalPanoramaData(location, signal) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            let received = false;
            const cleanup = () => {
                signal.removeEventListener('abort', abort);
                script.remove();
            };
            const abort = () => {
                cleanup();
                reject(new DOMException('Aborted', 'AbortError'));
            };
            if (signal.aborted) { abort(); return; }
            script.addEventListener('campus-panorama-data', event => {
                received = true;
                resolve(event.detail);
            }, { once: true });
            script.onload = () => {
                cleanup();
                if (!received) reject(new Error('本地全景资源不完整，请检查 assets 文件夹'));
            };
            script.onerror = () => {
                cleanup();
                reject(new Error('本地全景资源加载失败，请检查 assets 文件夹是否完整'));
            };
            signal.addEventListener('abort', abort, { once: true });
            script.src = location.panorama.replace(/\.webp$/i, '.local.js');
            document.head.appendChild(script);
        });
    }

    async function fetchPanorama(location, signal, onProgress) {
        if (cache.has(location.id)) {
            const blob = cache.get(location.id);
            cacheBlob(location.id, blob);
            if (onProgress) onProgress(blob.size, blob.size);
            return blob;
        }
        const source = window.location.protocol === 'file:'
            ? await loadLocalPanoramaData(location, signal) : location.panorama;
        const response = await fetch(source, { signal, cache: 'force-cache' });
        if (!response.ok) throw new Error('全景图片加载失败（HTTP ' + response.status + '）');
        const total = Number(response.headers.get('Content-Length')) || 0;
        const chunks = [];
        let loaded = 0;
        if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.byteLength;
                if (onProgress) onProgress(loaded, total);
            }
        } else {
            const bytes = await response.arrayBuffer();
            chunks.push(bytes);
            loaded = bytes.byteLength;
        }
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!loaded) throw new Error('全景图片内容为空');
        const blob = new Blob(chunks, { type: 'image/webp' });
        cacheBlob(location.id, blob);
        if (onProgress) onProgress(loaded, loaded);
        return blob;
    }

    function cancelPreload() {
        if (idleHandle !== undefined) {
            if ('cancelIdleCallback' in window) cancelIdleCallback(idleHandle);
            else clearTimeout(idleHandle);
            idleHandle = undefined;
        }
        if (preloadController) preloadController.abort();
    }

    function schedulePreload(location, token) {
        cancelPreload();
        if (navigator.connection && navigator.connection.saveData) return;
        const work = async () => {
            idleHandle = undefined;
            preloadController = new AbortController();
            const controller = preloadController;
            // Bound network and memory use: warm the first two adjacent scenes only.
            for (const id of location.neighbors.slice(0, 2)) {
                if (token !== sequence || controller.signal.aborted) return;
                try { await fetchPanorama(locations.get(id), controller.signal); }
                catch (_) { /* Optional warm-up must never interrupt the current view. */ }
            }
        };
        idleHandle = 'requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 1800 }) : setTimeout(work, 900);
    }

    function createHotspot(element, hotspot) {
        const destination = locations.get(hotspot.target);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hotspot-marker';
        button.dataset.targetId = hotspot.target;
        button.dataset.source = hotspot.source;
        button.setAttribute('aria-label', '查看' + (destination.menuLabel || destination.name) + '介绍');
        button.setAttribute('aria-controls', 'hotspot-label-' + hotspot.id);
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('pointerdown', event => event.stopPropagation());
        button.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            selectHotspot(hotspot.target, button);
        });
        const tooltip = document.createElement('div');
        tooltip.className = 'hotspot-tooltip';
        tooltip.id = 'hotspot-label-' + hotspot.id;
        tooltip.hidden = false;
        tooltip.setAttribute('role', 'group');
        tooltip.setAttribute('aria-label', (destination.menuLabel || destination.name) + '导览');
        const title = document.createElement('strong');
        title.className = 'hotspot-tooltip-title';
        title.textContent = destination.menuLabel || destination.name;
        const description = document.createElement('p');
        description.textContent = destination.shortDescription || destination.description;
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'hotspot-go';
        go.dataset.targetId = destination.id;
        go.textContent = '前往这里';
        go.setAttribute('aria-label', '前往' + (destination.menuLabel || destination.name));
        go.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            loadLocation(destination.id);
        });
        tooltip.addEventListener('pointerdown', event => event.stopPropagation());
        tooltip.addEventListener('click', event => event.stopPropagation());
        tooltip.append(title, description, go);
        element.append(button, tooltip);
    }

    function renderLocation(location, blob, token) {
        const job = async () => {
            if (token !== sequence) return false;
            const url = URL.createObjectURL(blob);
            const previousUrl = currentObjectUrl;
            const previousId = currentId;
            const view = overviewMode && location.id === configuration.overviewLocationId
                ? configuration.overviewView : { pitch: 0, yaw: 0, hfov: 100 };
            const scene = {
                type: 'equirectangular', panorama: url,
                hotSpots: location.hotspots.map(hotspot => ({
                    id: hotspot.id, pitch: hotspot.pitch, yaw: hotspot.yaw,
                    type: 'info', cssClass: 'campus-hotspot',
                    createTooltipFunc: createHotspot, createTooltipArgs: hotspot
                }))
            };
            try {
                await new Promise((resolve, reject) => {
                    let timer;
                    const clean = () => { clearTimeout(timer); viewer.off('load', loaded); viewer.off('error', failed); };
                    const loaded = () => { clean(); resolve(); };
                    const failed = error => { clean(); reject(new Error('全景渲染失败：' + String(error))); };
                    if (!viewer) {
                        viewer = pannellum.viewer('panorama-container', {
                            default: {
                                firstScene: location.id, autoLoad: true, showControls: false,
                                draggable: true, mouseZoom: true,
                                touchPanSpeedCoeffFactor: 1, friction: 0.15,
                                minHfov: 55, maxHfov: 120,
                                ...view, sceneFadeDuration: 0
                            },
                            scenes: { [location.id]: scene },
                            strings: { loadingLabel: '正在渲染全景…' }
                        });
                        viewer.on('load', loaded).on('error', failed);
                    } else {
                        viewer.on('load', loaded).on('error', failed);
                        viewer.addScene(location.id, scene);
                        viewer.loadScene(location.id, view.pitch, view.yaw, view.hfov);
                    }
                    timer = setTimeout(() => { clean(); reject(new Error('全景渲染超时，请重试')); }, 20000);
                });
                currentObjectUrl = url;
                if (previousUrl) URL.revokeObjectURL(previousUrl);
                if (previousId && previousId !== location.id) viewer.removeScene(previousId);
                if (token !== sequence) return false;
                currentId = location.id;
                container.dataset.sceneId = location.id;
                container.dataset.state = 'ready';
                container.setAttribute('aria-busy', 'false');
                showDescription(location);
                searchBox.value = location.name;
                overlay.hidden = true;
                schedulePreload(location, token);
                return true;
            } catch (error) {
                URL.revokeObjectURL(url);
                if (viewer) { viewer.destroy(); viewer = undefined; }
                if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = undefined;
                currentId = undefined;
                throw error;
            }
        };
        const result = renderTail.catch(() => {}).then(job);
        renderTail = result;
        return result;
    }

    async function loadLocation(id, { overview = false, showInfo = false } = {}) {
        const location = locations.get(id);
        if (!location) return;
        clearHotspotSelection();
        closeInfoCard();
        requestedInfo = showInfo;
        if (showInfo) {
            showDescription(location);
            infoCard.hidden = false;
            infoClose.hidden = false;
            infoCard.classList.add('is-open');
        }
        setOverviewMode(overview);
        if (!overview) normalLocationId = id;
        if (currentId === id && overlay.hidden) {
            showDescription(location);
            return;
        }
        const token = ++sequence;
        requestedId = id;
        if (foreground) foreground.abort();
        cancelPreload();
        foreground = new AbortController();
        const controller = foreground;
        overlay.hidden = false;
        retry.hidden = true;
        container.dataset.state = 'loading';
        container.setAttribute('aria-busy', 'true');
        preview.src = location.thumbnail;
        message.textContent = '正在加载' + location.name + '…';
        setProgress(0, 0);
        try {
            const blob = await fetchPanorama(location, controller.signal, (loaded, total) => {
                if (token === sequence) setProgress(loaded, total);
            });
            if (token !== sequence) return;
            message.textContent = '正在渲染' + location.name + '…';
            await renderLocation(location, blob, token);
        } catch (error) {
            if (token !== sequence || error.name === 'AbortError') return;
            message.textContent = error.message;
            percent.textContent = '请检查网络后重试';
            retry.hidden = false;
            container.dataset.state = 'error';
            container.setAttribute('aria-busy', 'false');
        }
    }

    retry.addEventListener('click', () => { if (requestedId) loadLocation(requestedId, { overview: overviewMode, showInfo: requestedInfo }); else initialize(); });
    window.addEventListener('pagehide', () => {
        cancelPreload();
        if (foreground) foreground.abort();
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    });

    async function initialize() {
        overlay.hidden = false;
        retry.hidden = true;
        message.textContent = '正在读取校园导览数据…';
        try {
            if (typeof CAMPUS_LOCATIONS === 'undefined') throw new Error('页面内联场景数据缺失');
            configuration = CAMPUS_LOCATIONS;
            if (!Array.isArray(configuration.locations) || configuration.locations.length !== 34) throw new Error('场景数据不完整');
            locations.clear(); names.clear();
            for (const location of configuration.locations) {
                locations.set(location.id, location);
                names.set(location.name, location);
                if (location.menuLabel) names.set(location.menuLabel, location);
            }
            for (const location of locations.values()) {
                if (!location.hotspots.every(hotspot => locations.has(hotspot.target))) throw new Error('存在无效的热点目标');
            }
            if (!locations.has(configuration.defaultLocationId)) throw new Error('默认场景不存在');
            buildMenu(configuration);
            aerial2d.disabled = !locations.has(configuration.overviewLocationId);
            await loadLocation(configuration.defaultLocationId);
        } catch (error) {
            message.textContent = error.message;
            percent.textContent = '导览暂时无法加载';
            retry.hidden = false;
        }
    }
    initialize();
})();
