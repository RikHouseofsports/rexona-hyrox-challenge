const params = new URLSearchParams(location.search);
if (params.get('error')) {
  document.getElementById('errorMsg').style.display = 'block';
}
