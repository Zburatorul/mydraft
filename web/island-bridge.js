export const ISLAND_CHANNEL = "myd:island";

export function islandThemeMessage(theme) {
  if (theme !== "light" && theme !== "dark") throw new Error("theme must be light or dark");
  return { channel: ISLAND_CHANNEL, type: "theme", theme };
}

export function parseIslandMessage(value) {
  if (!value || typeof value !== "object" || value.channel !== ISLAND_CHANNEL) return null;
  if (value.type === "pointerdown") return { type: "pointerdown" };
  if (value.type === "resize") {
    const height = Number(value.height);
    return Number.isFinite(height) && height >= 80 && height <= 20_000 ? { type: "resize", height: Math.ceil(height) } : null;
  }
  if (value.type === "annotate") {
    const target = typeof value.target === "string" ? value.target.trim() : "";
    if (!/^[A-Za-z][\w.:-]{0,159}$/.test(target)) return null;
    const x = Number(value.x), y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 100_000 || y > 100_000) return null;
    const message = { type: "annotate", target, ...(typeof value.text === "string" && value.text.trim() ? { text: value.text.trim().slice(0, 500) } : {}), x, y };
    return message;
  }
  return null;
}

export const ISLAND_BOOTSTRAP = `<script>(()=>{
  const send=(message)=>parent.postMessage({channel:"myd:island",...message},"*");
  const resize=()=>send({type:"resize",height:Math.ceil(document.documentElement.scrollHeight)});
  addEventListener("load",resize);
  new ResizeObserver(resize).observe(document.documentElement);
  addEventListener("message",event=>{
    const message=event.data;
    if(event.source===parent&&message?.channel==="myd:island"&&message.type==="theme"&&(message.theme==="light"||message.theme==="dark"))document.documentElement.dataset.mydTheme=message.theme;
  });
  addEventListener("pointerdown",()=>send({type:"pointerdown"}));
  addEventListener("click",event=>{
    const element=event.target.closest?.("[data-myd-id]");
    if(!element)return;
    const selection=getSelection();
    const text=selection&&!selection.isCollapsed?selection.toString().trim():"";
    send({type:"annotate",target:element.dataset.mydId,...(text?{text}:{}),x:event.clientX,y:event.clientY});
  });
})()<\/script>`;

export function islandDocument(source) {
  const closeBody = /<\/body\s*>/i;
  return closeBody.test(source) ? source.replace(closeBody, `${ISLAND_BOOTSTRAP}</body>`) : `${source}${ISLAND_BOOTSTRAP}`;
}

export function islandExportHydrationSource() {
  const bootstrap = JSON.stringify(ISLAND_BOOTSTRAP).replace(/<\//g, "<\\/");
  return `const islandBootstrap=${bootstrap};
function islandDocument(src){return /<\\/body\\s*>/i.test(src)?src.replace(/<\\/body\\s*>/i,islandBootstrap+"</body>"):src+islandBootstrap;}
addEventListener("message",event=>{if(!event.data||event.data.channel!=="myd:island"||event.data.type!=="resize")return;const frame=[...document.querySelectorAll(".rich.island iframe")].find(f=>f.contentWindow===event.source);const height=Number(event.data.height);if(frame&&Number.isFinite(height)&&height>=80&&height<=20000)frame.style.height=(Math.ceil(height)+8)+"px";});`;
}
