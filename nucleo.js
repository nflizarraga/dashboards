/* Núcleo compartido: derivar la clave, guardarla, descifrar y mostrar el candado.
   Se genera junto con el sitio; no hace falta tocarlo. */
(function () {
  "use strict";

  const CFG = window.BOVEDA_CFG; // { sal, iteraciones } — lo inyecta la construcción
  const LLAVE = "boveda-dashboards-v1";
  const te = new TextEncoder();
  const td = new TextDecoder();

  const b64aBytes = (b64) => Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
  const bytesAB64 = (bytes) => {
    let s = "";
    bytes.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  };

  async function derivar(password) {
    const base = await crypto.subtle.importKey("raw", te.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64aBytes(CFG.sal), iterations: CFG.iteraciones },
      base, 512
    );
    return new Uint8Array(bits).slice(0, 32); // solo la mitad de cifrado; la otra mitad nunca sale del build
  }

  const importar = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);

  async function descifrar(clave, b64) {
    const datos = b64aBytes(b64);
    const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: datos.slice(0, 12) }, clave, datos.slice(12));
    return td.decode(plano);
  }

  function guardar(raw, recordar) {
    const v = bytesAB64(raw);
    try { sessionStorage.setItem(LLAVE, v); } catch (e) {}
    try { recordar ? localStorage.setItem(LLAVE, v) : localStorage.removeItem(LLAVE); } catch (e) {}
    memoria = v;
  }
  let memoria = null;
  function leer() {
    let v = memoria;
    try { v = v || sessionStorage.getItem(LLAVE) || localStorage.getItem(LLAVE); } catch (e) {}
    return v ? b64aBytes(v) : null;
  }
  function olvidar() {
    memoria = null;
    try { sessionStorage.removeItem(LLAVE); } catch (e) {}
    try { localStorage.removeItem(LLAVE); } catch (e) {}
  }

  /* ---------- Pantalla de candado ---------- */
  function mostrarCandado({ alAbrir, detalle }) {
    document.body.classList.remove("bv-cargando");
    const cont = document.createElement("main");
    cont.className = "bv-candado";
    cont.innerHTML = `
      <form class="bv-tarjeta" autocomplete="on">
        <div class="bv-icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>
        </div>
        <h1>Archivo privado</h1>
        <p class="bv-sub">${detalle || "Ingresá la contraseña para ver el contenido."}</p>
        <input type="text" name="username" value="archivo" autocomplete="username" hidden>
        <label class="bv-campo">
          <span class="bv-oculto">Contraseña</span>
          <input type="password" name="password" autocomplete="current-password" placeholder="Contraseña" required autofocus>
          <button type="button" class="bv-ver" aria-label="Mostrar contraseña">Ver</button>
        </label>
        <label class="bv-check"><input type="checkbox" name="recordar" checked> Recordar en este dispositivo</label>
        <button type="submit" class="bv-boton"><span>Entrar</span></button>
        <p class="bv-error" role="alert" hidden></p>
      </form>`;
    document.body.appendChild(cont);

    const form = cont.querySelector("form");
    const input = form.password;
    const error = form.querySelector(".bv-error");
    const boton = form.querySelector(".bv-boton span");
    form.querySelector(".bv-ver").addEventListener("click", (e) => {
      const ver = input.type === "password";
      input.type = ver ? "text" : "password";
      e.currentTarget.textContent = ver ? "Ocultar" : "Ver";
      input.focus();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.hidden = true;
      form.classList.add("bv-trabajando");
      boton.textContent = "Abriendo…";
      try {
        const raw = await derivar(input.value);
        const ok = await alAbrir(raw);
        if (ok) {
          guardar(raw, form.recordar.checked);
          return;
        }
        throw new Error("clave");
      } catch (err) {
        form.classList.remove("bv-trabajando");
        boton.textContent = "Entrar";
        error.textContent = "Contraseña incorrecta. Probá de nuevo.";
        error.hidden = false;
        form.classList.remove("bv-sacudir");
        void form.offsetWidth;
        form.classList.add("bv-sacudir");
        input.select();
      }
    });
  }

  /* Intenta abrir con la clave guardada; si no hay o no sirve, muestra el candado. */
  async function conClave(intentar, detalle) {
    const raw = leer();
    if (raw) {
      try {
        if (await intentar(raw)) return;
      } catch (e) { /* clave vieja o cambiada */ }
      olvidar();
    }
    mostrarCandado({ alAbrir: intentar, detalle });
  }

  /* ---------- Página individual ---------- */
  function abrirPagina() {
    const datos = document.getElementById("bv-datos").textContent;
    conClave(async (raw) => {
      const html = await descifrar(await importar(raw), datos);
      await mostrarHtml(html);
      return true;
    }, "Esta página es parte de un archivo privado.");
  }

  async function mostrarHtml(html) {
    // document.open() se ignora mientras el documento original todavía se está parseando:
    // esperamos a que termine y salimos del script actual antes de reemplazarlo.
    if (document.readyState === "loading") {
      await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
    }
    await new Promise((r) => setTimeout(r, 0));
    document.open();
    document.write(html);
    document.close();
    const poner = () => {
      if (document.querySelector("boveda-inicio")) return;
      document.body.appendChild(document.createElement("boveda-inicio"));
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", poner) : poner();
  }

  // Botón flotante para volver al índice, aislado del CSS de cada página.
  if (!customElements.get("boveda-inicio")) {
    customElements.define("boveda-inicio", class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const s = this.attachShadow({ mode: "open" });
        s.innerHTML = `
          <style>
            a { position: fixed; z-index: 2147483647; left: 12px; bottom: calc(12px + env(safe-area-inset-bottom));
                display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px 0 11px;
                font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #fff; background: rgba(24, 26, 34, .78); border-radius: 999px; text-decoration: none;
                -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
                box-shadow: 0 4px 14px rgba(0,0,0,.18); opacity: .9; transition: opacity .15s, transform .15s; }
            a:hover { opacity: 1; transform: translateY(-1px); }
            a:focus-visible { outline: 2px solid #8fb3ff; outline-offset: 2px; }
            @media print { a { display: none; } }
          </style>
          <a href="../" aria-label="Volver al archivo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            Archivo
          </a>`;
      }
    });
  }

  window.Boveda = { derivar, importar, descifrar, guardar, leer, olvidar, conClave, abrirPagina };
})();
