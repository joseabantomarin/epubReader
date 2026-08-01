// Dispara la descarga de una URL. Un ancla temporal funciona igual en web y en
// el WebView de Android (allí MainActivity entrega la URL al gestor de
// descargas del sistema), así que hay un solo camino de código.
export function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
