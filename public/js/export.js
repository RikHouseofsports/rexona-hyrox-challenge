var currentParams = '';

function buildParams() {
  var p = new URLSearchParams();
  var event = document.getElementById('filterEvent').value;
  var date = document.getElementById('filterDate').value;
  var geslacht = document.getElementById('filterGeslacht').value;
  if (event) p.set('event', event);
  if (date) p.set('date', date);
  if (geslacht) p.set('geslacht', geslacht);
  return p.toString();
}

async function loadData(params) {
  var tbody = document.getElementById('exportTableBody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-msg loading">Laden\u2026</td></tr>';
  currentParams = params;

  try {
    var url = '/api/export/data' + (params ? '?' + params : '');
    var res = await fetch(url);
    if (!res.ok) throw new Error('Fout bij ophalen data');
    var rows = await res.json();

    document.getElementById('rowCount').textContent = rows.length;
    updateFilterSummary();

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Geen resultaten voor deze filters.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function(row) {
      var h = '<tr>';
      h += '<td>' + esc(row.voornaam) + '</td>';
      h += '<td>' + esc(row.achternaam) + '</td>';
      h += '<td>' + esc(row.email) + '</td>';
      h += '<td>' + esc(row.nationaliteit) + '</td>';
      h += '<td>' + esc(row.geslacht) + '</td>';
      h += '<td class="score-val">' + row.score_meters + '</td>';
      h += '<td>' + esc(row.event_naam) + '</td>';
      h += '<td>' + esc(row.datum) + '</td>';
      h += '<td class="' + (row.opt_in ? 'opt-in-ja' : 'opt-in-nee') + '">' + (row.opt_in ? 'Ja' : 'Nee') + '</td>';
      h += '</tr>';
      return h;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Fout bij laden data. Probeer opnieuw.</td></tr>';
    document.getElementById('rowCount').textContent = '\u2014';
  }
}

function updateFilterSummary() {
  var parts = [];
  var event = document.getElementById('filterEvent').value;
  var date = document.getElementById('filterDate').value;
  var geslacht = document.getElementById('filterGeslacht').value;
  if (event) parts.push(event);
  if (date) parts.push(date);
  if (geslacht) parts.push(geslacht);
  document.getElementById('filterSummary').textContent =
    parts.length ? 'Gefilterd op: ' + parts.join(', ') : 'Alle data';
}

function applyFilters() {
  loadData(buildParams());
}

function resetFilters() {
  document.getElementById('filterEvent').value = '';
  document.getElementById('filterDate').value = '';
  document.getElementById('filterGeslacht').value = '';
  loadData('');
}

function downloadCSV() {
  var params = buildParams();
  window.location = '/api/export/csv' + (params ? '?' + params : '');
}

function esc(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Button event listeners
document.getElementById('btnApply').addEventListener('click', applyFilters);
document.getElementById('btnReset').addEventListener('click', resetFilters);
document.getElementById('btnCSV').addEventListener('click', downloadCSV);

// Allow pressing Enter in filter fields to apply
['filterEvent','filterDate','filterGeslacht'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) {
    if (e.key === 'Enter') applyFilters();
  });
});

// Initial load
loadData('');
