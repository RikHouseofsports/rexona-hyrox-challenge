const alertSuccess = document.getElementById('alertSuccess');
const alertError = document.getElementById('alertError');
const submitBtn = document.getElementById('submitBtn');

function showAlert(el, msg) {
  el.textContent = msg || el.textContent;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// -- Load today's table --
async function loadTable() {
  try {
    const res = await fetch('/api/admin/today');
    const rows = await res.json();
    renderTable(rows);
  } catch (e) {
    console.error('Fout bij laden tabel:', e);
  }
}

function renderTable(rows) {
  const tbody = document.getElementById('tableBody');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Nog geen deelnemers vandaag.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(row => {
    var h = '<tr data-id="' + row.id + '">';
    h += '<td>' + esc(row.voornaam) + ' ' + esc(row.achternaam) + '</td>';
    h += '<td>' + esc(row.geslacht) + '</td>';
    h += '<td>' + esc(row.nationaliteit || '\u2014') + '</td>';
    h += '<td class="score-cell" data-score="' + row.score_meters + '">';
    h += '<span class="score-display">' + row.score_meters + ' m</span>';
    h += '<input class="score-input" type="number" min="0" max="9999" value="' + row.score_meters + '" style="display:none">';
    h += '</td>';
    h += '<td>' + esc(row.event_naam) + '</td>';
    h += '<td>' + esc(row.tijd) + '</td>';
    h += '<td>';
    h += '<button class="btn-edit" data-action="edit" data-id="' + row.id + '">Bewerk</button>';
    h += '<button class="btn-save" data-action="save" data-id="' + row.id + '" style="display:none">Opslaan</button>';
    h += '<button class="btn-cancel" data-action="cancel" data-original="' + row.score_meters + '" style="display:none">Annuleer</button>';
    h += '<button class="btn-delete" data-action="delete" data-id="' + row.id + '">Verwijder</button>';
    h += '</td></tr>';
    return h;
  }).join('');
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// -- Edit inline (event delegation) --
document.getElementById('participantsTable').addEventListener('click', function(e) {
  var btn = e.target.closest('button[data-action]');
  if (!btn) return;
  var action = btn.getAttribute('data-action');
  if (action === 'edit') startEdit(btn);
  else if (action === 'save') saveEdit(btn);
  else if (action === 'cancel') cancelEdit(btn);
  else if (action === 'delete') deleteScore(btn);
});

function startEdit(btn) {
  var row = btn.closest('tr');
  row.querySelector('.score-display').style.display = 'none';
  row.querySelector('.score-input').style.display = 'inline-block';
  row.querySelector('[data-action="edit"]').style.display = 'none';
  row.querySelector('[data-action="save"]').style.display = 'inline-block';
  row.querySelector('[data-action="cancel"]').style.display = 'inline-block';
}

function cancelEdit(btn) {
  var row = btn.closest('tr');
  var input = row.querySelector('.score-input');
  input.value = btn.getAttribute('data-original');
  input.style.display = 'none';
  row.querySelector('.score-display').style.display = 'inline';
  row.querySelector('[data-action="edit"]').style.display = 'inline-block';
  row.querySelector('[data-action="save"]').style.display = 'none';
  row.querySelector('[data-action="cancel"]').style.display = 'none';
}

async function saveEdit(btn) {
  var id = btn.getAttribute('data-id');
  var row = btn.closest('tr');
  var input = row.querySelector('.score-input');
  var score = parseInt(input.value, 10);
  if (isNaN(score) || score < 0 || score > 9999) {
    alert('Score moet tussen 0 en 9999 zijn.');
    return;
  }
  try {
    var res = await fetch('/api/admin/score/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score_meters: score }),
    });
    if (!res.ok) {
      var data = await res.json();
      alert(data.error || 'Fout bij opslaan.');
      return;
    }
    await loadTable();
  } catch (e) {
    alert('Netwerkfout. Probeer opnieuw.');
  }
}

async function deleteScore(btn) {
  var id = btn.getAttribute('data-id');
  if (!confirm('Weet je zeker dat je deze score wilt verwijderen?')) return;
  try {
    var res = await fetch('/api/admin/score/' + id, { method: 'DELETE' });
    if (!res.ok) {
      var data = await res.json();
      alert(data.error || 'Fout bij verwijderen.');
      return;
    }
    await loadTable();
  } catch (e) {
    alert('Netwerkfout. Probeer opnieuw.');
  }
}

// -- Register form --
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  alertSuccess.style.display = 'none';
  alertError.style.display = 'none';
  submitBtn.disabled = true;

  var formData = new FormData(e.target);
  var body = Object.fromEntries(formData.entries());

  try {
    var res = await fetch('/api/admin/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();

    if (res.ok) {
      showAlert(alertSuccess, '\u2713 Deelnemer succesvol geregistreerd!');
      e.target.reset();
      await loadTable();
    } else {
      var msg = data.errors ? data.errors.join(' ') : (data.error || 'Onbekende fout.');
      showAlert(alertError, '\u2717 ' + msg);
    }
  } catch (err) {
    showAlert(alertError, '\u2717 Netwerkfout. Controleer de verbinding.');
  } finally {
    submitBtn.disabled = false;
  }
});

// -- Auto-refresh table every 30s --
loadTable();
setInterval(loadTable, 30000);
