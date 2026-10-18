const SCRIPTS = [
  ["bengali", "Bengali / Assamese"],
  ["devanagari", "Devanagari (Hindi, Marathi, Nepali)"],
  ["gurmukhi", "Gurmukhi (Punjabi)"],
  ["gujarati", "Gujarati"],
  ["oriya", "Odia"],
  ["tamil", "Tamil"],
  ["telugu", "Telugu"],
  ["kannada", "Kannada"],
  ["malayalam", "Malayalam"],
  ["sinhala", "Sinhala"],
  ["myanmar", "Myanmar (Burmese)"],
];
// Mirrors runner.py so the preview shows the exact output path.
const STYLE_SUFFIX = /[-_ ](regular|bold|italic|bolditalic|bold italic)$/i;
const MAX_LOG_LINES = 3000;

const $ = (id) => document.getElementById(id);
const ui = {
  input: $("font-input"),
  dropzone: $("dropzone"),
  list: $("font-list"),
  script: $("script"),
  sizes: $("sizes"),
  includeLatin: $("include-latin"),
  darkenAa: $("darken-aa"),
  forceAutohint: $("force-autohint"),
  convert: $("convert"),
  status: $("status"),
  result: $("result"),
  resultFiles: $("result-files"),
  download: $("download"),
  logPanel: $("log-panel"),
  log: $("log"),
  versions: $("versions"),
};

const fonts = [];
let worker;
let engineReady = false;
let busy = false;
let downloadUrl;

for (const [value, label] of SCRIPTS) ui.script.add(new Option(label, value));

function deriveFamily(fileName) {
  return fileName.replace(/\.[^.]+$/, "").replace(STYLE_SUFFIX, "");
}

function sanitizeFamily(name) {
  return name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "Font";
}

function parseSizes() {
  const parts = ui.sizes.value.replace(/\s/g, "").split(",").filter(Boolean);
  if (!parts.length) return { error: "Enter at least one point size." };
  const sizes = [];
  for (const part of parts) {
    const size = Number(part);
    if (!Number.isInteger(size) || size < 6 || size > 72) return { error: `"${part}" is not a size between 6 and 72.` };
    if (!sizes.includes(size)) sizes.push(size);
  }
  return { sizes };
}

function outputFamily(font) {
  return sanitizeFamily(font.family.trim() || deriveFamily(font.file.name));
}

function setStatus(text, kind = "") {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`.trim();
}

function appendLog(line) {
  const lines = ui.log.textContent ? ui.log.textContent.split("\n") : [];
  lines.push(line);
  ui.log.textContent = lines.slice(-MAX_LOG_LINES).join("\n");
  ui.log.scrollTop = ui.log.scrollHeight;
}

function validate() {
  const { error: sizeError, sizes } = parseSizes();
  ui.sizes.setAttribute("aria-invalid", String(Boolean(sizeError)));
  const families = fonts.map(outputFamily);
  const duplicate = families.find((name, i) => families.indexOf(name) !== i);

  let problem = "";
  if (!fonts.length) problem = "Add at least one font to start.";
  else if (sizeError) problem = sizeError;
  else if (duplicate) problem = `Two fonts would both be named "${duplicate}". Give one a different family name.`;

  ui.convert.disabled = busy || Boolean(problem);
  if (!busy) setStatus(problem || `Ready to convert ${fonts.length} font${fonts.length > 1 ? "s" : ""} at ${sizes.join(", ")} pt.`,
    problem && fonts.length ? "error" : "");
  return !problem;
}

function renderList() {
  ui.list.replaceChildren(...fonts.map((font) => {
    const li = document.createElement("li");

    const file = document.createElement("div");
    file.className = "file";
    file.textContent = font.file.name;
    const size = document.createElement("small");
    size.textContent = ` ${(font.file.size / 1024).toFixed(0)} KB`;
    file.append(size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${font.file.name}`);
    remove.disabled = busy;
    remove.addEventListener("click", () => {
      fonts.splice(fonts.indexOf(font), 1);
      renderList();
    });

    const family = document.createElement("label");
    family.className = "family";
    const caption = document.createElement("span");
    caption.textContent = "Family name";
    const input = document.createElement("input");
    input.type = "text";
    input.value = font.family;
    input.placeholder = deriveFamily(font.file.name);
    input.disabled = busy;
    family.append(caption, input);

    const path = document.createElement("div");
    path.className = "path";
    const updatePath = () => {
      const name = outputFamily(font);
      const firstSize = parseSizes().sizes?.[0] ?? 12;
      path.textContent = `→ .fonts/${name}/${name}_${firstSize}.cpfont`;
    };
    input.addEventListener("input", () => {
      font.family = input.value;
      updatePath();
      validate();
    });
    updatePath();

    li.append(file, remove, family, path);
    return li;
  }));
  validate();
}

function addFiles(fileList) {
  const added = [...fileList].filter((file) => /\.ttf$/i.test(file.name));
  const skipped = fileList.length - added.length;
  for (const file of added) {
    if (fonts.some((f) => f.file.name === file.name && f.file.size === file.size)) continue;
    fonts.push({ file, family: sanitizeFamily(deriveFamily(file.name)) });
  }
  renderList();
  if (skipped) setStatus(`Skipped ${skipped} file${skipped > 1 ? "s" : ""} that ${skipped > 1 ? "aren't" : "isn't"} .ttf.`, "error");
  if (fonts.length) startWorker();
}

function startWorker() {
  if (worker) return;
  worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  worker.addEventListener("message", onWorkerMessage);
  worker.addEventListener("error", (event) => {
    finish();
    setStatus(`The converter failed to start: ${event.message || "check your connection and reload."}`, "error");
    worker = undefined;
  });
  worker.postMessage({ type: "warmup" });
}

function onWorkerMessage({ data }) {
  if (data.type === "log") {
    appendLog(data.line);
  } else if (data.type === "ready") {
    engineReady = true;
    ui.versions.textContent = `Engine: FreeType ${data.freetype}, fontTools ${data.fonttools}, Pyodide.`;
  } else if (data.type === "done") {
    finish();
    showResult(data.files, data.zip);
  } else if (data.type === "error") {
    appendLog(data.detail);
    if (busy) {
      finish();
      setStatus(`Conversion failed: ${data.message}`, "error");
      ui.logPanel.open = true;
    } else {
      setStatus(`Could not load the converter: ${data.message}`, "error");
    }
  }
}

function finish() {
  busy = false;
  ui.input.disabled = false;
  renderList();
}

function showResult(files, zip) {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const families = [...new Set(files.map((f) => f.split("/")[1]))];
  ui.download.href = downloadUrl;
  ui.download.download = families.length === 1 ? `${families[0]}-cpfont.zip` : "cpfont-fonts.zip";
  ui.resultFiles.replaceChildren(...files.map((name) => Object.assign(document.createElement("li"), { textContent: name })));
  ui.result.hidden = false;
  setStatus(`Done: ${files.length} file${files.length > 1 ? "s" : ""} for ${families.join(", ")}.`);
  ui.download.click();
}

async function convert() {
  if (busy || !validate()) return;
  busy = true;
  ui.input.disabled = true;
  ui.result.hidden = true;
  ui.log.textContent = "";
  renderList();
  setStatus(engineReady ? "Converting…" : "Loading the converter (up to 15 MB the first time, then cached), then converting…", "busy");
  startWorker();

  const payload = await Promise.all(fonts.map(async (font) => ({
    fileName: font.file.name,
    family: outputFamily(font),
    bytes: new Uint8Array(await font.file.arrayBuffer()),
  })));
  worker.postMessage({
    type: "convert",
    fonts: payload,
    options: {
      script: ui.script.value,
      sizes: parseSizes().sizes.join(","),
      includeLatin: ui.includeLatin.checked,
      darkenAa: ui.darkenAa.checked,
      forceAutohint: ui.forceAutohint.checked,
    },
  });
}

ui.input.addEventListener("change", () => {
  addFiles(ui.input.files);
  ui.input.value = "";
});
for (const type of ["dragenter", "dragover"]) {
  ui.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    ui.dropzone.classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  ui.dropzone.addEventListener(type, () => ui.dropzone.classList.remove("dragging"));
}
ui.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  if (!busy) addFiles(event.dataTransfer.files);
});
ui.sizes.addEventListener("input", renderList);
ui.convert.addEventListener("click", convert);
validate();
