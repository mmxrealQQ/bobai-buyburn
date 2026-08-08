// Haelt das Copyright-Jahr im Footer aktuell.
// Als externe Datei, weil die CSP (script-src 'self') Inline-Skripte blockiert.
(function () {
  var el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
})();
