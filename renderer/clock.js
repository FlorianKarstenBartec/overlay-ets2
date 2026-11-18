const el = document.getElementById("time");

function tick() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  el.textContent = `${h}:${m}`;
}

tick();
setInterval(tick, 1000);
