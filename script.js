/* eslint-disable no-console */
// ======== GLOBAL STATE ========
const APP = {
  allFeatures: [],
  filteredFeatures: [],
  map: null,
  clusterGroup: null,
  heatLayer: null,
  markers: [],
  charts: {},
};

let sidebarCollapsed = false;

const CONFIG = {
  DEFAULT_VIEW: { center: [46.6, 2.2], zoom: 6 },
  CLUSTER_RADIUS: 80,
  HEAT_OPTIONS: { radius: 25, blur: 15, maxZoom: 8, minOpacity: 0.25 },
  RISK_COLORS: {
    1: '#10b981',
    2: '#f59e0b',
    3: '#f97316',
    4: '#ef4444',
    5: '#dc2626',
  },
  SEARCH_FIELDS: [
    'Etablissement',
    'Adresse',
    'N° établissement',
    'Code NAF',
    'NAF',
    'Secteur référent',
    'Intervenant prévu',
    'Médecin référent',
    'Type établissement',
  ],
  CATEGORY_FIELDS: [
    'Actif inactif',
    'Type établissement',
    'Secteur référent',
    'Médecin référent',
    'Intervenant prévu',
    'Cat-Eff_Niv',
    'Condition réalisation',
    'Suite FE',
    'Rédacteur',
    'Fiche entreprise créée par',
    'Fiche entreprise mise à jour par',
  ],
  NUMERIC_FIELDS: [
    'Nombre d\'individus suivis',
    'Niv Risque',
    'Niv_Adh',
    'Index_Cat-Eff_Niv',
    'Age FE (CREA ou MAJ)',
    'Priorité proposée',
    'Année Prévue',
    'Trimestre Prévu',
  ],
  DATE_FIELDS: [
    'Date d\'adhésion établissement',
    'Date création fiche entreprise',
    'Date mise à jour fiche entreprise',
    'Date envoi FE adhérent',
  ],
};

const log = (...args) => console.log('[CarteDashboard]', ...args);

// ======== NORMALIZATION ========
const Normalizer = {
  /**
   * Normalise une chaîne de caractères :
   * - Trim des espaces
   * - Suppression des accents
   * - Gestion de la casse (première lettre en majuscule pour chaque mot)
   * - Gestion des caractères spéciaux
   */
  normalizeText(text) {
    if (!text || typeof text !== 'string') return '';

    // Trim et suppression des espaces multiples
    let normalized = text.trim().replace(/\s+/g, ' ');

    // Si vide après trim, retourner chaîne vide
    if (!normalized) return '';

    // Suppression des accents pour la comparaison
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Mettre en minuscule d'abord
    normalized = normalized.toLowerCase();

    // Capitaliser la première lettre de chaque mot
    // Gère les tirets, apostrophes, etc.
    normalized = normalized.replace(/\b\w/g, (char) => char.toUpperCase());

    return normalized;
  },

  /**
   * Normalise une valeur numérique
   * Retourne null si la valeur n'est pas un nombre valide
   */
  normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  },

  /**
   * Vérifie si une valeur est considérée comme vide/nulle
   */
  isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (typeof value === 'number' && !Number.isFinite(value)) return true;
    return false;
  },

  /**
   * Normalise une valeur pour l'affichage dans les dropdowns
   * Garde les accents et la casse originale mais trim et nettoie
   */
  normalizeForDisplay(text) {
    if (!text || typeof text !== 'string') return '';

    // Trim et suppression des espaces multiples
    let normalized = text.trim().replace(/\s+/g, ' ');

    // Si vide après trim, retourner chaîne vide
    if (!normalized) return '';

    // Capitaliser la première lettre de chaque mot (garde les accents)
    normalized = normalized.toLowerCase().replace(/\b\w/gu, (char) => char.toUpperCase());

    return normalized;
  }
};

// ======== HELPERS ========
const Loader = {
  element: null,
  init() {
    this.element = document.getElementById('loadingOverlay');
  },
  show() {
    if (!this.element) return;
    this.element.classList.add('active');
    this.element.setAttribute('aria-hidden', 'false');
  },
  hide() {
    if (!this.element) return;
    this.element.classList.remove('active');
    this.element.setAttribute('aria-hidden', 'true');
  },
};

const debounce = (fn, delay = 250) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(null, args), delay);
  };
};

const showToast = (message, variant = 'info') => {
  const colors = {
    info: '#6366f1',
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
  };
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 10000;
    padding: 14px 20px;
    border-radius: 10px;
    font-weight: 600;
    color: #ffffff;
    background: ${colors[variant] || colors.info};
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.25);
    opacity: 0;
    transition: opacity 200ms ease, transform 200ms ease;
    transform: translateY(-10px);
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
};

const getElement = (id) => document.getElementById(id);

// ======== DATA LOADING ========
async function loadGeoJSON() {
  log('loadGeoJSON: fetching data');
  const response = await fetch('etablissements.geojson');
  if (!response.ok) {
    throw new Error(`Impossible de charger le GeoJSON (${response.status})`);
  }
  const geojson = await response.json();
  const features = Array.isArray(geojson.features) ? geojson.features : [];

  APP.allFeatures = features.filter((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return false;
    const [lng, lat] = coords;
    return Number.isFinite(lat) && Number.isFinite(lng);
  });

  APP.filteredFeatures = [...APP.allFeatures];
  log('loadGeoJSON: retained features', APP.allFeatures.length);
}

// ======== MAP INITIALIZATION ========
function initMap() {
  const mapEl = getElement('map');
  if (!mapEl) throw new Error('Conteneur carte introuvable');

  APP.map = L.map(mapEl, {
    center: CONFIG.DEFAULT_VIEW.center,
    zoom: CONFIG.DEFAULT_VIEW.zoom,
    preferCanvas: true,
    zoomControl: false,
  });

  const light = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  });
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  });
  light.addTo(APP.map);
  L.control.layers({ Clair: light, Sombre: dark }, null, { position: 'bottomright' }).addTo(APP.map);

  APP.clusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: CONFIG.CLUSTER_RADIUS,
    showCoverageOnHover: false,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let className = 'marker-cluster marker-cluster-';
      let size = 40;

      if (count >= 5000) {
        className += 'mega';
        size = 60;
      } else if (count >= 1000) {
        className += 'huge';
        size = 55;
      } else if (count >= 500) {
        className += 'xlarge';
        size = 50;
      } else if (count >= 100) {
        className += 'large';
        size = 45;
      } else if (count >= 50) {
        className += 'medium-large';
        size = 42;
      } else if (count >= 20) {
        className += 'medium';
        size = 40;
      } else if (count >= 10) {
        className += 'small-medium';
        size = 38;
      } else {
        className += 'small';
        size = 35;
      }

      return L.divIcon({
        html: '<div>' + count + '</div>',
        className: className,
        iconSize: L.point(size, size)
      });
    }
  });
  APP.map.addLayer(APP.clusterGroup);
}

// ======== FILTER UI ========
function buildFilters() {
  const categories = {};
  const normalizedMap = {}; // Map pour retrouver les valeurs originales

  APP.allFeatures.forEach((feature) => {
    const props = feature.properties || {};
    CONFIG.CATEGORY_FIELDS.forEach((field) => {
      const rawValue = props[field];

      // Ignorer les valeurs vides ou nulles
      if (Normalizer.isEmpty(rawValue)) return;

      const valueStr = String(rawValue);
      const normalizedKey = Normalizer.normalizeText(valueStr);

      // Si la normalisation donne une chaîne vide, ignorer
      if (!normalizedKey) return;

      if (!categories[field]) {
        categories[field] = new Map(); // Utiliser Map au lieu de Set
        normalizedMap[field] = new Map();
      }

      // Stocker la valeur normalisée pour l'affichage
      const displayValue = Normalizer.normalizeForDisplay(valueStr);

      // Compter les occurrences pour chaque valeur normalisée
      const currentCount = categories[field].get(normalizedKey) || 0;
      categories[field].set(normalizedKey, currentCount + 1);

      // Garder la meilleure version pour l'affichage (la plus propre)
      if (!normalizedMap[field].has(normalizedKey) || displayValue.length > 0) {
        normalizedMap[field].set(normalizedKey, displayValue);
      }
    });
  });

  const fieldMap = {
    'Actif inactif': 'filterActif',
    'Type établissement': 'filterTypeEtab',
    'Secteur référent': 'filterSecteur',
    'Médecin référent': 'filterMedecin',
    'Intervenant prévu': 'filterIntervenant',
    'Cat-Eff_Niv': 'filterCatEff',
    'Condition réalisation': 'filterCondition',
    'Suite FE': 'filterSuite',
    'Rédacteur': 'filterRedacteur',
    'Fiche entreprise créée par': 'filterCreateurFE',
    'Fiche entreprise mise à jour par': 'filterMajFE',
  };

  Object.entries(fieldMap).forEach(([field, selectId]) => {
    const select = getElement(selectId);
    if (!select) return;

    // Vider les options sauf la première
    while (select.options.length > 1) select.remove(1);

    const values = categories[field];
    const displayValues = normalizedMap[field];
    if (!values || values.size === 0) return;

    const sortedKeys = Array.from(values.keys())
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    sortedKeys.forEach((key) => {
      const count = values.get(key);
      const displayValue = displayValues.get(key);
      if (!displayValue) return; // Ne pas ajouter d'options vides

      const option = document.createElement('option');
      option.value = key;
      option.textContent = displayValue; // Afficher la version propre
      option.dataset.count = count;
      select.appendChild(option);
    });
  });
}

function setSidebarCollapsed(collapsed, { focus = true, maintainView = false } = {}) {
  const sidebar = document.querySelector('.sidebar');
  const toggleInside = getElement('sidebarToggle');
  const reopenButton = getElement('sidebarCollapsedToggle');
  if (!sidebar) return;

  sidebarCollapsed = collapsed;
  sidebar.classList.toggle('collapsed', collapsed);

  if (toggleInside) {
    toggleInside.setAttribute('aria-expanded', String(!collapsed));
    toggleInside.setAttribute('title', collapsed ? 'Afficher les filtres' : 'Masquer les filtres');
    const icon = toggleInside.querySelector('.toggle-icon');
    if (icon) icon.textContent = collapsed ? '▶' : '◀';
    if (!collapsed && focus) {
      toggleInside.focus({ preventScroll: true });
    }
  }

  if (reopenButton) {
    reopenButton.classList.toggle('visible', collapsed);
    reopenButton.setAttribute('aria-hidden', collapsed ? 'false' : 'true');
    reopenButton.setAttribute('aria-label', collapsed ? 'Afficher les filtres' : 'Masquer les filtres');
    reopenButton.textContent = collapsed ? '▶' : '◀';
    if (collapsed && focus) {
      reopenButton.focus({ preventScroll: true });
    }
  }

  requestAnimationFrame(() => {
    if (!APP.map) return;
    APP.map.invalidateSize();
    if (collapsed) {
      const targetZoom = Math.max(APP.map.getZoom(), 6.5);
      APP.map.flyTo(CONFIG.DEFAULT_VIEW.center, targetZoom, { duration: 0.35 });
    } else if (!maintainView && APP.filteredFeatures.length) {
      updateDisplay({ fitBounds: true });
    }
  });
}


function getFilterState() {
  const value = (id) => getElement(id)?.value || '';
  const num = (id, fallback = null) => {
    const raw = value(id);
    if (raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const dateValue = (id) => value(id);
  const boolValue = (id, defaultValue) => {
    const input = getElement(id);
    return input ? Boolean(input.checked) : defaultValue;
  };

  return {
    // On garde la valeur brute pour la gestion des tags et du multi-critères
    search: value('searchInput'),
    actif: value('filterActif'),
    typeEtab: value('filterTypeEtab'),
    secteur: value('filterSecteur'),
    medecin: value('filterMedecin'),
    intervenant: value('filterIntervenant'),
    catEff: value('filterCatEff'),
    condition: value('filterCondition'),
    suite: value('filterSuite'),
    redacteur: value('filterRedacteur'),
    createurFE: value('filterCreateurFE'),
    majFE: value('filterMajFE'),
    minIndividus: num('minIndividus', -Infinity),
    maxIndividus: num('maxIndividus', Infinity),
    minRisque: num('minRisque', -Infinity),
    maxRisque: num('maxRisque', Infinity),
    minNivAdh: num('minNivAdh', -Infinity),
    maxNivAdh: num('maxNivAdh', Infinity),
    minIndex: num('minIndex', -Infinity),
    maxIndex: num('maxIndex', Infinity),
    minAge: num('minAge', -Infinity),
    maxAge: num('maxAge', Infinity),
    minPrioProp: num('minPrioProp', -Infinity),
    maxPrioProp: num('maxPrioProp', Infinity),
    minAnnee: num('minAnnee', -Infinity),
    maxAnnee: num('maxAnnee', Infinity),
    minTrimestre: num('minTrimestre', -Infinity),
    maxTrimestre: num('maxTrimestre', Infinity),
    minDateAdh: dateValue('minDateAdh'),
    maxDateAdh: dateValue('maxDateAdh'),
    minDateCrea: dateValue('minDateCrea'),
    maxDateCrea: dateValue('maxDateCrea'),
    minDateMaj: dateValue('minDateMaj'),
    maxDateMaj: dateValue('maxDateMaj'),
    minDateEnvoi: dateValue('minDateEnvoi'),
    maxDateEnvoi: dateValue('maxDateEnvoi'),
    clustering: boolValue('toggleClustering', true),
    heatmap: boolValue('toggleHeatmap', false),
    sansFE: boolValue('filterSansFE', false),
  };
}

function matchesFilters(feature, filters) {
  const props = feature.properties || {};

  // Filtre "Sans FE" - entreprises sans fiche d'entreprise
  if (filters.sansFE) {
    const dateCreationFE = props['Date création fiche entreprise'];
    // Une entreprise est "Sans FE" si elle n'a pas de date de création de FE (null ou undefined)
    if (dateCreationFE !== null && dateCreationFE !== undefined && dateCreationFE !== '') {
      return false;
    }
  }

  if (filters.search) {
    // Gère la recherche multi-critères avec ";" comme séparateur (logique OR)
    const searchTerms = filters.search.split(';').map(term => Normalizer.normalizeText(term.trim())).filter(Boolean);

    if (searchTerms.length > 0) {
      // Logique OR : au moins un terme doit matcher
      const anyTermMatches = searchTerms.some(term =>
        CONFIG.SEARCH_FIELDS.some(field => {
          const propValue = Normalizer.normalizeText(String(props[field] || ''));
          return propValue.includes(term);
        })
      );
      if (!anyTermMatches) return false;
    }
  }

  const categoryMap = [
    ['actif', 'Actif inactif'],
    ['typeEtab', 'Type établissement'],
    ['secteur', 'Secteur référent'],
    ['medecin', 'Médecin référent'],
    ['intervenant', 'Intervenant prévu'],
    ['catEff', 'Cat-Eff_Niv'],
    ['condition', 'Condition réalisation'],
    ['suite', 'Suite FE'],
    ['redacteur', 'Rédacteur'],
    ['createurFE', 'Fiche entreprise créée par'],
    ['majFE', 'Fiche entreprise mise à jour par'],
  ];
  for (const [filterKey, propKey] of categoryMap) {
    if (filters[filterKey]) {
      // Normaliser les deux valeurs pour la comparaison
      const filterNormalized = Normalizer.normalizeText(filters[filterKey]);
      const propNormalized = Normalizer.normalizeText(String(props[propKey] || ''));
      if (propNormalized !== filterNormalized) return false;
    }
  }

  const rangeChecks = [
    ['Nombre d\'individus suivis', filters.minIndividus, filters.maxIndividus],
    ['Niv Risque', filters.minRisque, filters.maxRisque],
    ['Niv_Adh', filters.minNivAdh, filters.maxNivAdh],
    ['Index_Cat-Eff_Niv', filters.minIndex, filters.maxIndex],
    ['Age FE (CREA ou MAJ)', filters.minAge, filters.maxAge],
    ['Priorité proposée', filters.minPrioProp, filters.maxPrioProp],
    ['Année Prévue', filters.minAnnee, filters.maxAnnee],
    ['Trimestre Prévu', filters.minTrimestre, filters.maxTrimestre],
  ];
  for (const [prop, min, max] of rangeChecks) {
    const value = Number(props[prop]);
    if (!Number.isFinite(value)) continue;
    if (value < min || value > max) return false;
  }

  const dateChecks = [
    ['Date d\'adhésion établissement', filters.minDateAdh, filters.maxDateAdh],
    ['Date création fiche entreprise', filters.minDateCrea, filters.maxDateCrea],
    ['Date mise à jour fiche entreprise', filters.minDateMaj, filters.maxDateMaj],
    ['Date envoi FE adhérent', filters.minDateEnvoi, filters.maxDateEnvoi],
  ];
  for (const [prop, min, max] of dateChecks) {
    const value = props[prop];
    if (!value) continue;
    if (min && value < min) return false;
    if (max && value > max) return false;
  }

  return true;
}

function setCounters() {
  const totalEl = getElement('totalCount');
  const filteredEl = getElement('filteredCount');
  if (totalEl) totalEl.textContent = APP.allFeatures.length.toString();
  if (filteredEl) filteredEl.textContent = APP.filteredFeatures.length.toString();

  const sumEmployees = (features) =>
    features.reduce((acc, feature) => {
      const value = Number(feature?.properties?.["Nombre d'individus suivis"]);
      return Number.isFinite(value) ? acc + value : acc;
    }, 0);

  const totalEmployeesEl = getElement('totalEmployees');
  const filteredEmployeesEl = getElement('filteredEmployees');
  if (totalEmployeesEl) totalEmployeesEl.textContent = sumEmployees(APP.allFeatures).toLocaleString('fr-FR');
  if (filteredEmployeesEl) filteredEmployeesEl.textContent = sumEmployees(APP.filteredFeatures).toLocaleString('fr-FR');
}

function clearMarkers() {
  if (APP.clusterGroup) {
    APP.clusterGroup.clearLayers();
  }
  APP.markers.forEach((marker) => {
    if (APP.map && APP.map.hasLayer(marker)) {
      APP.map.removeLayer(marker);
    }
  });
  APP.markers = [];
  if (APP.heatLayer && APP.map) {
    APP.map.removeLayer(APP.heatLayer);
    APP.heatLayer = null;
  }
}

function createMarker(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const props = feature.properties || {};
  const risk = Number(props['Niv Risque']);
  const color = CONFIG.RISK_COLORS[risk] || '#4b5563';
  const individuals = Number(props["Nombre d'individus suivis"]) || 0;
  const radius = Math.max(6, Math.min(16, 6 + Math.sqrt(individuals)));

  // Bordure colorée selon le niveau de risque
  const borderColors = {
    1: '#10b981',
    2: '#fbbf24',
    3: '#f97316',
    4: '#ef4444'
  };
  const borderColor = borderColors[risk] || '#64748b';

  const marker = L.circleMarker([lat, lng], {
    radius,
    color: borderColor,
    weight: 2.5,
    fillColor: color,
    fillOpacity: 0.8,
  });

  marker.on('click', () => showPopup(marker, props));
  marker.on('mouseover', () => marker.setStyle({ weight: 3.5, fillOpacity: 0.95 }));
  marker.on('mouseout', () => marker.setStyle({ weight: 2.5, fillOpacity: 0.8 }));

  return marker;
}

function showPopup(marker, props) {
  const risk = Number(props['Niv Risque']);
  const riskLabels = {
    1: 'Très faible',
    2: 'Faible',
    3: 'Moyen',
    4: 'Élevé'
  };
  const riskColors = {
    1: '#10b981',
    2: '#fbbf24',
    3: '#f97316',
    4: '#ef4444'
  };

  let html = '<div class="popup-content">';
  html += `<div class="popup-title">${props['Etablissement'] || 'N/A'}</div>`;
  if (props['Adresse']) {
    html += `<div class="popup-subtitle">${props['Adresse']}</div>`;
  }

  // Badge de risque en évidence
  if (risk >= 1 && risk <= 4) {
    html += `<div class="risk-badge-container">
      <div class="risk-badge" style="background: linear-gradient(135deg, ${riskColors[risk]}, ${riskColors[risk]}dd); box-shadow: 0 4px 12px ${riskColors[risk]}50;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <div>
          <div class="risk-label">Niveau de risque</div>
          <div class="risk-level">${risk}/4 - ${riskLabels[risk]}</div>
        </div>
      </div>
    </div>`;
  }

  const fields = [
    ['N° établissement', 'N° établissement'],
    ['Actif', 'Actif inactif'],
    ['Type', 'Type établissement'],
    ['Secteur', 'Secteur référent'],
    ['Médecin', 'Médecin référent'],
    ['Intervenant', 'Intervenant prévu'],
    ['Code NAF', 'Code NAF'],
    ['NAF', 'NAF'],
    ['Priorité proposée', 'Priorité proposée'],
    ['Priorité retenue', 'Priorité retenue'],
    ['Année prévue', 'Année Prévue'],
  ];

  fields.forEach(([label, key]) => {
    const value = props[key];
    if (value !== undefined && value !== null && value !== '') {
      html += `<div class="popup-field"><span class="popup-label">${label} :</span><span class="popup-value">${value}</span></div>`;
    }
  });
  html += '</div>';
  marker.bindPopup(html, { maxWidth: 360 }).openPopup();
}

function updateDisplay({ fitBounds = true } = {}) {
  clearMarkers();
  setCounters();

  const filters = getFilterState();
  const useClustering = filters.clustering !== false;
  const heatData = [];
  const bounds = [];

  APP.filteredFeatures.forEach((feature) => {
    const marker = createMarker(feature);
    const [lng, lat] = feature.geometry.coordinates;
    bounds.push([lat, lng]);
    heatData.push([lat, lng, 0.6]);

    if (useClustering) {
      APP.clusterGroup.addLayer(marker);
    } else {
      marker.addTo(APP.map);
      APP.markers.push(marker);
    }
  });

  if (!useClustering) {
    APP.clusterGroup.clearLayers();
  }

  if (filters.heatmap && heatData.length) {
    APP.heatLayer = L.heatLayer(heatData, CONFIG.HEAT_OPTIONS).addTo(APP.map);
  }

  if (fitBounds && bounds.length) {
    const leafletBounds = L.latLngBounds(bounds);
    APP.map.fitBounds(leafletBounds, { padding: [40, 40] });
  }
}

function applyFilters({ silent = false } = {}) {
  const filters = getFilterState();
  APP.filteredFeatures = APP.allFeatures.filter((feature) => matchesFilters(feature, filters));
  updateDisplay();
  saveStateToURL();
  if (!silent) {
    const count = APP.filteredFeatures.length;
    showToast(`${count} établissement${count > 1 ? 's' : ''} affiché${count > 1 ? 's' : ''}`, count ? 'success' : 'warning');
  }
}

function updateRiskFilterInputs() {
  const activeButtons = document.querySelectorAll('.risk-btn.active');
  const risks = Array.from(activeButtons).map(btn => Number(btn.getAttribute('data-risk')));

  if (risks.length === 0) {
    getElement('minRisque').value = '';
    getElement('maxRisque').value = '';
  } else {
    const min = Math.min(...risks);
    const max = Math.max(...risks);
    getElement('minRisque').value = min;
    getElement('maxRisque').value = max;
  }
}

function resetFilters() {
  const inputsToClear = [
    // searchInput est géré séparément pour les tags
    'searchInput',
    'filterActif',
    'filterTypeEtab',
    'filterSecteur',
    'filterMedecin',
    'filterIntervenant',
    'filterCatEff',
    'filterCondition',
    'filterSuite',
    'filterRedacteur',
    'filterCreateurFE',
    'filterMajFE',
    'minIndividus','maxIndividus',
    'minRisque','maxRisque',
    'minNivAdh','maxNivAdh',
    'minIndex','maxIndex',
    'minAge','maxAge',
    'minPrioProp','maxPrioProp',
    'minAnnee','maxAnnee',
    'minTrimestre','maxTrimestre',
    'minDateAdh','maxDateAdh',
    'minDateCrea','maxDateCrea',
    'minDateMaj','maxDateMaj',
    'minDateEnvoi','maxDateEnvoi',
  ];
  inputsToClear.forEach((id) => {
    const input = getElement(id);
    if (input) input.value = '';
  });
  const clusteringToggle = getElement('toggleClustering');

  // Vider les tags de recherche
  updateSearchTags();

  if (clusteringToggle) clusteringToggle.checked = true;
  const heatToggle = getElement('toggleHeatmap');
  if (heatToggle) heatToggle.checked = false;

  // Reset risk buttons
  document.querySelectorAll('.risk-btn').forEach(btn => btn.classList.remove('active'));

  APP.filteredFeatures = [...APP.allFeatures];
  updateDisplay();
  saveStateToURL();
  showToast('Filtres réinitialisés', 'info');
}

// ======== STATISTICS ========
function computeStats(features) {
  const stats = {
    // Distributions basiques
    actif: {},
    type: {},
    secteur: {},
    intervenant: {},
    medecin: {},
    catEff: {},
    risque: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },

    // Analyses temporelles
    timeline: {},
    timelineByYear: {},
    timelineByQuarter: {},

    // Fiches d'entreprises
    avecFE: 0,
    sansFE: 0,
    feParCreateur: {},
    feParCondition: {},
    feSuite: {},

    // Métriques avancées
    totalEmployees: 0,
    avgEmployeesByCompany: 0,
    employeesByRisk: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },

    // Priorités
    priorites: {},

    // NAF
    topNAF: {},

    // Âge moyen des FE
    agesAggregated: [],

    // Statistiques générales
    total: features.length,
  };

  let totalAge = 0;
  let countAge = 0;

  features.forEach((feature) => {
    const props = feature.properties || {};
    const addCount = (map, key) => {
      if (!key || key === 'null' || key === 'undefined') return;
      map[key] = (map[key] || 0) + 1;
    };

    // Distributions basiques
    addCount(stats.actif, props['Actif inactif']);
    addCount(stats.type, props['Type établissement']);
    addCount(stats.secteur, props['Secteur référent']);
    addCount(stats.intervenant, props['Intervenant prévu']);
    addCount(stats.medecin, props['Médecin référent']);
    addCount(stats.catEff, props['Cat-Eff_Niv']);

    // Niveau de risque
    const risk = Number(props['Niv Risque']);
    if (risk >= 1 && risk <= 5) stats.risque[risk] += 1;

    // Timeline
    const dateCrea = props['Date création fiche entreprise'];
    const dateMaj = props['Date mise à jour fiche entreprise'];
    const date = dateMaj || dateCrea;
    if (date && typeof date === 'string' && date.length >= 7) {
      const month = date.substring(0, 7);
      const year = date.substring(0, 4);
      stats.timeline[month] = (stats.timeline[month] || 0) + 1;
      stats.timelineByYear[year] = (stats.timelineByYear[year] || 0) + 1;
    }

    // Trimestre prévu
    const trimestre = props['Trimestre Prévu'];
    const annee = props['Année Prévue'];
    if (trimestre && annee) {
      const key = `${annee}-T${trimestre}`;
      stats.timelineByQuarter[key] = (stats.timelineByQuarter[key] || 0) + 1;
    }

    // Fiches d'entreprises
    if (dateCrea) {
      stats.avecFE++;
      addCount(stats.feParCreateur, props['Fiche entreprise créée par']);
      addCount(stats.feParCondition, props['Condition réalisation']);
      addCount(stats.feSuite, props['Suite FE']);
    } else {
      stats.sansFE++;
    }

    // Âge des FE
    const age = Number(props['Age FE (CREA ou MAJ)']);
    if (Number.isFinite(age) && age >= 0) {
      stats.agesAggregated.push(age);
      totalAge += age;
      countAge++;
    }

    // Priorités
    const prio = props['Priorité proposée'] || props['Priorité retenue'];
    if (prio) addCount(stats.priorites, String(prio));

    // NAF
    const naf = props['Code NAF'];
    if (naf) addCount(stats.topNAF, naf);

    // Employés
    const employees = Number(props['Nombre d\'individus suivis']);
    if (Number.isFinite(employees) && employees > 0) {
      stats.totalEmployees += employees;
      if (risk >= 1 && risk <= 5) {
        stats.employeesByRisk[risk] += employees;
      }
    }
  });

  // Calculs finaux
  stats.avgEmployeesByCompany = stats.total > 0 ? (stats.totalEmployees / stats.total).toFixed(2) : 0;
  stats.avgAgeFE = countAge > 0 ? (totalAge / countAge).toFixed(2) : 0;
  stats.medianAgeFE = stats.agesAggregated.length > 0 ? calculateMedian(stats.agesAggregated) : 0;

  // Top 10 NAF
  stats.topNAF = Object.entries(stats.topNAF)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

  return stats;
}

function calculateMedian(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2)
    : sorted[mid].toFixed(2);
}

function renderStats(stats) {
  const statsBody = getElement('statsBody');
  if (!statsBody) return;

  // Calculer le pourcentage de FE
  const percentFE = stats.total > 0 ? ((stats.avecFE / stats.total) * 100).toFixed(1) : 0;
  const percentSansFE = stats.total > 0 ? ((stats.sansFE / stats.total) * 100).toFixed(1) : 0;

  statsBody.innerHTML = `
    <!-- Hero Stats Cards -->
    <div class="stats-hero">
      <div class="stats-hero-card hero-primary">
        <div class="hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          </svg>
        </div>
        <div class="hero-content">
          <div class="hero-value">${stats.total.toLocaleString('fr-FR')}</div>
          <div class="hero-label">Établissements</div>
        </div>
      </div>

      <div class="stats-hero-card hero-success">
        <div class="hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
          </svg>
        </div>
        <div class="hero-content">
          <div class="hero-value">${stats.totalEmployees.toLocaleString('fr-FR')}</div>
          <div class="hero-label">Salariés Total</div>
          <div class="hero-sublabel">Moy: ${stats.avgEmployeesByCompany} / entreprise</div>
        </div>
      </div>

      <div class="stats-hero-card hero-info">
        <div class="hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="hero-content">
          <div class="hero-value">${stats.avecFE.toLocaleString('fr-FR')}</div>
          <div class="hero-label">Avec Fiche Entreprise</div>
          <div class="hero-sublabel">${percentFE}% du total</div>
        </div>
      </div>

      <div class="stats-hero-card hero-warning">
        <div class="hero-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <div class="hero-content">
          <div class="hero-value">${stats.sansFE.toLocaleString('fr-FR')}</div>
          <div class="hero-label">Sans Fiche Entreprise</div>
          <div class="hero-sublabel">${percentSansFE}% du total</div>
        </div>
      </div>
    </div>

    <!-- KPIs Section -->
    <div class="stats-section">
      <h3 class="stats-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        Indicateurs Clés
      </h3>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Âge Moyen FE</div>
          <div class="kpi-value">${stats.avgAgeFE} <span class="kpi-unit">ans</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Âge Médian FE</div>
          <div class="kpi-value">${stats.medianAgeFE} <span class="kpi-unit">ans</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Risque Moyen</div>
          <div class="kpi-value">${calculateAvgRisk(stats.risque).toFixed(2)} <span class="kpi-unit">/ 5</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Entreprises Actives</div>
          <div class="kpi-value">${(stats.actif['Actif'] || 0).toLocaleString('fr-FR')}</div>
        </div>
      </div>
    </div>

    <!-- Charts Grid -->
    <div class="stats-section">
      <h3 class="stats-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="20" x2="18" y2="10"></line>
          <line x1="12" y1="20" x2="12" y2="4"></line>
          <line x1="6" y1="20" x2="6" y2="14"></line>
        </svg>
        Analyses Détaillées
      </h3>
      <div class="charts-grid">
        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Répartition par Niveau de Risque</div>
            <div class="chart-subtitle">Distribution des risques identifiés</div>
          </div>
          <canvas id="chartRisque"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Salariés par Niveau de Risque</div>
            <div class="chart-subtitle">Impact en nombre de salariés</div>
          </div>
          <canvas id="chartEmployeesByRisk"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Statut des Établissements</div>
            <div class="chart-subtitle">Actifs vs Inactifs</div>
          </div>
          <canvas id="chartActif"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Catégories d'Effectif</div>
            <div class="chart-subtitle">Distribution par taille d'entreprise</div>
          </div>
          <canvas id="chartCatEff"></canvas>
        </div>

        <div class="chart-container chart-large">
          <div class="chart-header">
            <div class="chart-title">Top 10 Codes NAF</div>
            <div class="chart-subtitle">Secteurs d'activité les plus représentés</div>
          </div>
          <canvas id="chartTopNAF"></canvas>
        </div>

        <div class="chart-container chart-large">
          <div class="chart-header">
            <div class="chart-title">Timeline des Fiches (12 derniers mois)</div>
            <div class="chart-subtitle">Créations et mises à jour mensuelles</div>
          </div>
          <canvas id="chartTimeline"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Fiches par Créateur</div>
            <div class="chart-subtitle">Top contributeurs</div>
          </div>
          <canvas id="chartFeParCreateur"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Conditions de Réalisation</div>
            <div class="chart-subtitle">Mode de réalisation des fiches</div>
          </div>
          <canvas id="chartCondition"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Secteurs Référents</div>
            <div class="chart-subtitle">Distribution géographique</div>
          </div>
          <canvas id="chartSecteur"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Intervenants Prévus</div>
            <div class="chart-subtitle">Charge de travail par intervenant</div>
          </div>
          <canvas id="chartIntervenant"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Type d'Établissement</div>
            <div class="chart-subtitle">Typologie des entreprises</div>
          </div>
          <canvas id="chartType"></canvas>
        </div>

        <div class="chart-container chart-medium">
          <div class="chart-header">
            <div class="chart-title">Médecins Référents</div>
            <div class="chart-subtitle">Répartition par médecin</div>
          </div>
          <canvas id="chartMedecin"></canvas>
        </div>
      </div>
    </div>
  `;

  // Draw all charts
  setTimeout(() => {
    // Helper pour extraire labels et valeurs de manière sûre
    const safeExtract = (obj, limit = null) => {
      const entries = Object.entries(obj).filter(([k, v]) => k && v > 0);
      const limited = limit ? entries.slice(0, limit) : entries;
      return {
        labels: limited.map(([k]) => k),
        values: limited.map(([, v]) => v)
      };
    };

    // Graphiques avec données complètes
    const risque = safeExtract(stats.risque);
    drawChart('chartRisque', 'doughnut', risque.labels, risque.values, 'Niv. Risque');

    const employeesByRisk = safeExtract(stats.employeesByRisk);
    drawChart('chartEmployeesByRisk', 'bar', employeesByRisk.labels, employeesByRisk.values, 'Salariés');

    const actif = safeExtract(stats.actif);
    drawChart('chartActif', 'doughnut', actif.labels, actif.values, 'Statut');

    const catEff = safeExtract(stats.catEff);
    drawChart('chartCatEff', 'bar', catEff.labels, catEff.values, 'Effectif');

    const topNAF = safeExtract(stats.topNAF, 10);
    drawChart('chartTopNAF', 'bar', topNAF.labels, topNAF.values, 'NAF');

    // Timeline (last 12 months)
    const timelineEntries = Object.entries(stats.timeline)
      .filter(([, v]) => v > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);
    if (timelineEntries.length > 0) {
      drawChart('chartTimeline', 'line', timelineEntries.map(([k]) => k), timelineEntries.map(([, v]) => v), 'Fiches');
    }

    const feParCreateur = safeExtract(stats.feParCreateur, 10);
    drawChart('chartFeParCreateur', 'bar', feParCreateur.labels, feParCreateur.values, 'Créateur');

    const feParCondition = safeExtract(stats.feParCondition);
    drawChart('chartCondition', 'doughnut', feParCondition.labels, feParCondition.values, 'Condition');

    const secteur = safeExtract(stats.secteur);
    drawChart('chartSecteur', 'bar', secteur.labels, secteur.values, 'Secteur');

    const intervenant = safeExtract(stats.intervenant, 10);
    drawChart('chartIntervenant', 'bar', intervenant.labels, intervenant.values, 'Intervenant');

    const type = safeExtract(stats.type);
    drawChart('chartType', 'bar', type.labels, type.values, 'Type');

    const medecin = safeExtract(stats.medecin, 10);
    drawChart('chartMedecin', 'bar', medecin.labels, medecin.values, 'Médecin');
  }, 100);
}

function calculateAvgRisk(risqueStats) {
  let total = 0;
  let count = 0;
  Object.entries(risqueStats).forEach(([level, num]) => {
    total += Number(level) * num;
    count += num;
  });
  return count > 0 ? total / count : 0;
}

function drawChart(canvasId, type, labels, data, title) {
  const canvas = getElement(canvasId);
  if (!canvas) return;

  // Nettoyer les données invalides
  const cleanData = data.map(d => Number.isFinite(d) ? d : 0);
  const cleanLabels = labels.map(l => String(l || 'N/A'));

  // Si toutes les données sont à 0 ou vides, ne pas afficher le graphique
  if (cleanData.every(d => d === 0) || cleanData.length === 0) {
    const container = canvas.closest('.chart-container');
    if (container) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #9ca3af; display: flex; align-items: center; justify-content: center; min-height: 280px;">Aucune donnée disponible</div>';
    }
    return;
  }

  // Forcer la taille du canvas pour éviter les bugs de redimensionnement
  const container = canvas.parentElement;
  const containerHeight = 340; // Hauteur fixe augmentée pour les légendes
  canvas.style.height = containerHeight + 'px';
  canvas.style.maxHeight = containerHeight + 'px';
  canvas.height = containerHeight;

  const ctx = canvas.getContext('2d');
  if (APP.charts[canvasId]) {
    APP.charts[canvasId].destroy();
  }

  const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#f97316'];

  // Calculer le max pour ajuster l'échelle avec une marge de sécurité
  const maxValue = Math.max(...cleanData);
  const suggestedMax = maxValue > 0 ? Math.ceil(maxValue * 1.15) : 10;

  // Pour les graphiques avec de grandes valeurs, ajuster le stepSize
  const stepSize = suggestedMax > 100 ? Math.ceil(suggestedMax / 8) : Math.ceil(suggestedMax / 10);

  const chartConfig = {
    type,
    data: {
      labels: cleanLabels,
      datasets: [{
        label: title,
        data: cleanData,
        backgroundColor: type === 'line' ? 'rgba(99,102,241,0.25)' : palette,
        borderColor: type === 'line' ? '#6366f1' : palette,
        borderWidth: 2,
        tension: 0.35,
        fill: type === 'line',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 10,
          bottom: 10,
        }
      },
      plugins: {
        legend: {
          display: type === 'doughnut',
          position: 'bottom',
          align: 'start',
          labels: {
            font: { size: 12 },
            padding: 12,
            usePointStyle: true,
            boxWidth: 12,
            boxHeight: 12,
          },
          maxHeight: 80,
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.label || '';
              if (label) label += ': ';
              const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
              label += Number(value).toLocaleString('fr-FR');
              return label;
            }
          }
        }
      },
      scales: type === 'doughnut' ? {} : {
        y: {
          beginAtZero: true,
          max: suggestedMax,
          grace: '5%',
          ticks: {
            stepSize: stepSize,
            precision: 0,
            callback: function(value) {
              return Number.isInteger(value) ? value.toLocaleString('fr-FR') : '';
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
            drawBorder: true,
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            font: { size: 10 },
            autoSkip: true,
            maxTicksLimit: 15,
          },
          grid: {
            display: false,
            drawBorder: true,
          }
        },
      },
    },
  };

  try {
    APP.charts[canvasId] = new Chart(ctx, chartConfig);
  } catch (error) {
    console.error(`Erreur lors de la création du graphique ${canvasId}:`, error);
    const container = canvas.closest('.chart-container');
    if (container) {
      container.innerHTML = '<div style="padding: 40px; text-align: center; color: #ef4444;">Erreur de chargement du graphique</div>';
    }
  }
}

function showStats() {
  const modal = getElement('statsModal');
  if (!modal) return;
  const stats = computeStats(APP.filteredFeatures);
  renderStats(stats);
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeStats() {
  const modal = getElement('statsModal');
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

// ======== EXPORT ========
function exportCSV() {
  if (APP.filteredFeatures.length === 0) {
    showToast('Aucune donnée à exporter', 'warning');
    return;
  }
  const headers = Object.keys(APP.filteredFeatures[0].properties || {});
  const rows = APP.filteredFeatures.map((feature) => headers.map((header) => {
    const value = feature.properties?.[header] ?? '';
    const stringValue = String(value).replace(/"/g, '""');
    return /[",\n]/.test(stringValue) ? `"${stringValue}"` : stringValue;
  }).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  downloadFile(csv, 'etablissements.csv', 'text/csv;charset=utf-8;');
  showToast('Export CSV effectué', 'success');
}

function exportGeoJSON() {
  if (APP.filteredFeatures.length === 0) {
    showToast('Aucune donnée à exporter', 'warning');
    return;
  }
  const geojson = {
    type: 'FeatureCollection',
    features: APP.filteredFeatures,
  };
  downloadFile(JSON.stringify(geojson, null, 2), 'etablissements.geojson', 'application/geo+json');
  showToast('Export GeoJSON effectué', 'success');
}

function exportData() {
  const modal = getElement('exportModal');
  if (!modal) return;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeExportModal() {
  const modal = getElement('exportModal');
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 0);
}

// ======== URL STATE ========
function saveStateToURL() {
  const filters = getFilterState();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (typeof value === 'boolean') {
      if (value) params.set(key, String(value));
      return;
    }
    if (value !== '' && value !== null && value !== undefined && value !== -Infinity && value !== Infinity) {
      params.set(key, value);
    }
  });
  const query = params.toString();
  const newURL = query ? `?${query}` : window.location.pathname;
  window.history.replaceState(null, '', newURL);
}

function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  if ([...params].length === 0) return;
  params.forEach((value, key) => {
    const elementId = getElementId(key);
    const input = getElement(elementId);
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = value === 'true';
    } else {
      input.value = value;
    }
  });
  applyFilters({ silent: true });
}

function getElementId(key) {
  const map = {
    search: 'searchInput',
    actif: 'filterActif',
    typeEtab: 'filterTypeEtab',
    secteur: 'filterSecteur',
    medecin: 'filterMedecin',
    intervenant: 'filterIntervenant',
    catEff: 'filterCatEff',
    condition: 'filterCondition',
    suite: 'filterSuite',
    redacteur: 'filterRedacteur',
    createurFE: 'filterCreateurFE',
    majFE: 'filterMajFE',
    minIndividus: 'minIndividus',
    maxIndividus: 'maxIndividus',
    minRisque: 'minRisque',
    maxRisque: 'maxRisque',
    minNivAdh: 'minNivAdh',
    maxNivAdh: 'maxNivAdh',
    minIndex: 'minIndex',
    maxIndex: 'maxIndex',
    minAge: 'minAge',
    maxAge: 'maxAge',
    minPrioProp: 'minPrioProp',
    maxPrioProp: 'maxPrioProp',
    minAnnee: 'minAnnee',
    maxAnnee: 'maxAnnee',
    minTrimestre: 'minTrimestre',
    maxTrimestre: 'maxTrimestre',
    minDateAdh: 'minDateAdh',
    maxDateAdh: 'maxDateAdh',
    minDateCrea: 'minDateCrea',
    maxDateCrea: 'maxDateCrea',
    minDateMaj: 'minDateMaj',
    maxDateMaj: 'maxDateMaj',
    minDateEnvoi: 'minDateEnvoi',
    maxDateEnvoi: 'maxDateEnvoi',
    clustering: 'toggleClustering',
    heatmap: 'toggleHeatmap',
  };
  return map[key] || key;
}

// ======== EVENT BINDING ========
function attachEventListeners() {
  getElement('applyBtn')?.addEventListener('click', () => applyFilters({ silent: false }));
  getElement('resetBtn')?.addEventListener('click', resetFilters);
  getElement('statsBtn')?.addEventListener('click', showStats);
  getElement('exportBtn')?.addEventListener('click', exportData);
  getElement('logoutBtn')?.addEventListener('click', () => {
    if (confirm('Voulez-vous vraiment vous déconnecter ?')) {
      window.authUtils.logout();
    }
  });
  getElement('toggleClustering')?.addEventListener('change', () => updateDisplay({ fitBounds: false }));
  getElement('toggleHeatmap')?.addEventListener('change', () => updateDisplay({ fitBounds: false }));
  getElement('filterSansFE')?.addEventListener('change', () => applyFilters({ silent: false }));

  // Gestion intelligente de la barre de recherche multi-critères
  const searchInput = getElement('searchInput');
  if (searchInput) {
    // Debounced search
    const debouncedSearch = debounce(() => {
      applyFilters({ silent: true });
      updateSearchTags();
    }, 300);

    searchInput.addEventListener('input', (e) => {
      const value = e.target.value;

      // Si on a un point-virgule, mettre à jour immédiatement les tags
      if (value.includes(';')) {
        applyFilters({ silent: true });
        updateSearchTags();
      } else {
        // Sinon, utiliser le debounce pour une recherche fluide
        debouncedSearch();
      }
    });

    // Gérer la touche "Entrée" pour valider un tag
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim() !== '') {
        e.preventDefault();
        if (!e.target.value.endsWith(';')) {
          e.target.value += '; ';
        }
        applyFilters({ silent: true });
        updateSearchTags();
      }
    });

    // Au blur, mettre à jour les tags si nécessaire
    searchInput.addEventListener('blur', () => {
      updateSearchTags();
    });
  }

  const sidebarButton = getElement('sidebarToggle');
  if (sidebarButton) {
    sidebarButton.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
  }
  const reopenButton = getElement('sidebarCollapsedToggle');
  if (reopenButton) {
    reopenButton.addEventListener('click', () => setSidebarCollapsed(false));
  }

  // Risk filter buttons
  document.querySelectorAll('.risk-btn').forEach(button => {
    button.addEventListener('click', () => {
      button.classList.toggle('active');
      updateRiskFilterInputs();
    });
  });

  // Export modal listeners
  getElement('exportCSVBtn')?.addEventListener('click', () => {
    exportCSV();
    closeExportModal();
  });
  getElement('exportGeoJSONBtn')?.addEventListener('click', () => {
    exportGeoJSON();
    closeExportModal();
  });
  getElement('exportModalClose')?.addEventListener('click', closeExportModal);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeStats();
      closeExportModal();
    }
  });
  getElement('statsModal')?.addEventListener('click', (event) => {
    if (!event.target.closest('.modal-content')) closeStats();
  });
  getElement('exportModal')?.addEventListener('click', (event) => {
    if (!event.target.closest('.modal-content')) closeExportModal();
  });
}

// ======== SECTION TOGGLE ========
function toggleSection(headerElement) {
  const section = headerElement.closest('.filter-section');
  const toggle = headerElement.querySelector('.filter-section-toggle');

  if (section.classList.contains('collapsed')) {
    section.classList.remove('collapsed');
    toggle.textContent = '−';
  } else {
    section.classList.add('collapsed');
    toggle.textContent = '+';
  }
}

// ======== SEARCH TAGS UI ========
function updateSearchTags() {
  const searchInput = getElement('searchInput');
  const tagsContainer = getElement('searchTags');
  if (!searchInput || !tagsContainer) return;

  const terms = searchInput.value.split(';').map(t => t.trim()).filter(Boolean);
  tagsContainer.innerHTML = '';

  if (terms.length > 0) {
    terms.forEach(term => {
      const tag = document.createElement('div');
      tag.className = 'search-tag';
      tag.dataset.term = term;

      const textSpan = document.createElement('span');
      textSpan.className = 'search-tag-text';
      textSpan.textContent = term;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'search-tag-remove';
      removeBtn.setAttribute('aria-label', `Supprimer le critère ${term}`);
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

      removeBtn.addEventListener('click', () => {
        removeSearchTerm(term);
      });

      tag.appendChild(textSpan);
      tag.appendChild(removeBtn);
      tagsContainer.appendChild(tag);
    });
  }
}

function removeSearchTerm(termToRemove) {
  const searchInput = getElement('searchInput');
  if (!searchInput) return;

  const currentSearch = searchInput.value;
  const terms = currentSearch.split(';').map(t => t.trim()).filter(Boolean);
  const newTerms = terms.filter(t => t !== termToRemove);

  searchInput.value = newTerms.length > 0 ? newTerms.join('; ') : '';

  updateSearchTags();
  applyFilters({ silent: false });
  searchInput.focus();
}

// ======== ENTRYPOINT ========
window.addEventListener('load', async () => {
  try {
    Loader.init();
    Loader.show();
    await loadGeoJSON();
    initMap();
    buildFilters();
    attachEventListeners();
    setSidebarCollapsed(false, { focus: false, maintainView: true });
    updateSearchTags(); // Pour charger les tags depuis l'URL
    loadStateFromURL();
    updateDisplay();
    showToast(`${APP.filteredFeatures.length} établissements chargés`, 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Erreur inattendue', 'error');
  } finally {
    Loader.hide();
  }
});
