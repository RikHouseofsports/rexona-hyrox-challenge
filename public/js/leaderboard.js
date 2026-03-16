var SWITCH_INTERVAL = 7000;
var currentGender = 'men';
var leaderboard = { men: [], women: [] };
var switchTimer = null;

var COUNTRY_MAP = {
  'Nederland':       { code: 'NED', iso: 'nl' },
  'Belgi\u00eb':          { code: 'BEL', iso: 'be' },
  'Duitsland':       { code: 'GER', iso: 'de' },
  'Groot-Brittanni\u00eb':{ code: 'GBR', iso: 'gb' },
  'Australi\u00eb':       { code: 'AUS', iso: 'au' },
  'Canada':          { code: 'CAN', iso: 'ca' },
  'Denemarken':      { code: 'DEN', iso: 'dk' },
  'Finland':         { code: 'FIN', iso: 'fi' },
  'Frankrijk':       { code: 'FRA', iso: 'fr' },
  'Griekenland':     { code: 'GRE', iso: 'gr' },
  'Hongarije':       { code: 'HUN', iso: 'hu' },
  'Ierland':         { code: 'IRL', iso: 'ie' },
  'Itali\u00eb':          { code: 'ITA', iso: 'it' },
  'Japan':           { code: 'JPN', iso: 'jp' },
  'Kroati\u00eb':         { code: 'CRO', iso: 'hr' },
  'Letland':         { code: 'LAT', iso: 'lv' },
  'Litouwen':        { code: 'LTU', iso: 'lt' },
  'Luxemburg':       { code: 'LUX', iso: 'lu' },
  'Mexico':          { code: 'MEX', iso: 'mx' },
  'Nieuw-Zeeland':   { code: 'NZL', iso: 'nz' },
  'Noorwegen':       { code: 'NOR', iso: 'no' },
  'Oekra\u00efne':        { code: 'UKR', iso: 'ua' },
  'Oostenrijk':      { code: 'AUT', iso: 'at' },
  'Polen':           { code: 'POL', iso: 'pl' },
  'Portugal':        { code: 'POR', iso: 'pt' },
  'Roemeni\u00eb':        { code: 'ROU', iso: 'ro' },
  'Rusland':         { code: 'RUS', iso: 'ru' },
  'Singapore':       { code: 'SGP', iso: 'sg' },
  'Sloveni\u00eb':        { code: 'SLO', iso: 'si' },
  'Slowakije':       { code: 'SVK', iso: 'sk' },
  'Spanje':          { code: 'ESP', iso: 'es' },
  'Tsjechi\u00eb':        { code: 'CZE', iso: 'cz' },
  'Turkije':         { code: 'TUR', iso: 'tr' },
  'USA':             { code: 'USA', iso: 'us' },
  'Zweden':          { code: 'SWE', iso: 'se' },
  'Zwitserland':     { code: 'SUI', iso: 'ch' },
  'Zuid-Afrika':     { code: 'RSA', iso: 'za' },
  'Zuid-Korea':      { code: 'KOR', iso: 'kr' },
};

function getNat(nationaliteit) {
  var c = COUNTRY_MAP[nationaliteit];
  if (!c) return '';
  return '<img class="nat-flag" src="https://flagcdn.com/w40/' + c.iso + '.png" alt="' + c.code + '">' + c.code;
}

// -- Render --
function renderRows(data, tableId) {
  var tbody = document.querySelector('#' + tableId + ' tbody');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Nog geen scores</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(function(row, i) {
    var rank = i + 1;
    var rankClass = rank <= 3 ? 'rank-' + rank : '';
    var h = '<tr class="' + rankClass + '">';
    h += '<td class="col-rank">' + rank + '</td>';
    h += '<td class="col-naam">' + esc(row.naam) + '</td>';
    h += '<td class="col-nat">' + getNat(row.nationaliteit) + '</td>';
    h += '<td class="col-score">' + row.score_meters + '<span class="score-unit">m</span></td>';
    h += '</tr>';
    return h;
  }).join('');
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAll() {
  renderRows(leaderboard.men, 'tableMen');
  renderRows(leaderboard.women, 'tableWomen');
}

// -- Panel switch --
function showPanel(gender) {
  currentGender = gender;
  document.getElementById('panelMen').classList.toggle('active', gender === 'men');
  document.getElementById('panelWomen').classList.toggle('active', gender === 'women');
}

function startRotation() {
  if (switchTimer) clearInterval(switchTimer);
  showPanel('men');
  switchTimer = setInterval(function() {
    showPanel(currentGender === 'men' ? 'women' : 'men');
  }, SWITCH_INTERVAL);
}

// -- WebSocket --
var ws = null;
var reconnectTimeout = null;

function connect() {
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);

  ws.onopen = function() {
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  };

  ws.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'leaderboard_update') {
        leaderboard = { men: data.men || [], women: data.women || [] };
        renderAll();
      }
    } catch (e) { /* ignore malformed */ }
  };

  ws.onclose = function() {
    reconnectTimeout = setTimeout(connect, 3000);
  };

  ws.onerror = function() { ws.close(); };
}

// -- Init --
renderAll();
startRotation();
connect();
