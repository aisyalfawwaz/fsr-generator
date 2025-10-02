import { useEffect, useMemo, useRef, useState } from "react";

// FSR Generator (single-file React component for Vite)
// Upgrades:
// - Image uploads (logo, evidence photos) + captions
// - Signature image uploads (FSE, Trainer)
// - Autosave (localStorage)
// - JSON export/import
// - BEST PDF EXPORT: multi‑page A4 slicing at high DPI (configurable quality)
// - Live A4 preview
// - Minimal deps: jspdf, html2canvas, dayjs, clsx
//
// HOW TO USE
// 1) npm create vite@latest fsr-gen -- --template react
// 2) cd fsr-gen && npm i jspdf html2canvas dayjs clsx
// 3) (optional) Tailwind (recommended)
// 4) Replace src/App.jsx with this file → npm run dev

import dayjs from "dayjs";
import clsx from "clsx";

const A4_WIDTH_PX = 794; // ~210mm @96dpi (preview)
const STORAGE_KEY = "fsr_form_v2";

const defaultForm = {
  // Admin
  swoNo: "",
  fsrNo: autoFSRNumber(),

  // Customer
  customerName: "",
  address: "",
  contactPerson: "",
  phone: "",

  // System
  modality: "IGT/CV",
  model: "Allura Centron",
  serialNo: "",
  productNo: "",

  // Timing
  startTravelDate: "",
  startTravelTime: "08:00",
  arrivedDate: "",
  arrivedTime: "09:30",
  workStartDate: "",
  workStartTime: "10:00",
  workFinishDate: "",
  workFinishTime: "17:00",
  breakdown: "",

  // Types
  jobTypes: { siteSurvey: false, training: false, corrective: false, installation: false, update: false, preventive: false },
  serviceTypes: { chargeable: true, contract: false, warranty: false },

  // Work notes
  problem: "",
  action: "",
  jobStatus: "Incomplete",
  statusChargeable: "Chargeable", // Chargeable / FOC / Borrow
  conditionWhenLeave: "",

  // Parts
  parts: [{ partName: "", partNo: "", qty: "", status: "" }],

  // Media
  logo: null, // base64
  photos: [], // [{id, src, caption}]

  // Signatures
  fseName: "",
  trainerName: "",
  fseSign: null,
  trainerSign: null,
};

function autoFSRNumber() {
  return `FSR-${dayjs().format("YYMMDD-HHmmss")}`;
}

function Section({ title, children, right }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
        {right}
      </div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}
function Row({ children, cols = 2 }) {
  return <div className={clsx("grid gap-3", cols === 1 ? "grid-cols-1" : `md:grid-cols-${cols}`)}>{children}</div>;
}
function Input({ label, type = "text", ...props }) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-gray-600">{label}</div>
      <input type={type} className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" {...props} />
    </label>
  );
}
function TextArea({ label, ...props }) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-gray-600">{label}</div>
      <textarea className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 min-h-[96px]" {...props} />
    </label>
  );
}
function Checkbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export default function App() {
  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : defaultForm;
  });
  const [pdfQuality, setPdfQuality] = useState(3); // 2..5 (render scale)

  const previewRef = useRef(null);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(form)), [form]);

  const set = (path, value) =>
    setForm((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys.at(-1)] = value;
      return next;
    });

  // Prefill dates today
  const today = useMemo(() => dayjs().format("YYYY-MM-DD"), []);
  useEffect(() => {
    if (!form.startTravelDate) set("startTravelDate", today);
    if (!form.arrivedDate) set("arrivedDate", today);
    if (!form.workStartDate) set("workStartDate", today);
    if (!form.workFinishDate) set("workFinishDate", today);
  }, []); // eslint-disable-line

  // Parts ops
  const addPart = () => setForm((p) => ({ ...p, parts: [...p.parts, { partName: "", partNo: "", qty: "", status: "" }] }));
  const removePart = (idx) => setForm((p) => ({ ...p, parts: p.parts.filter((_, i) => i !== idx) }));

  // Media ops
  const onFileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });

  const onLogoUpload = async (file) => {
    if (file) set("logo", await onFileToBase64(file));
  };
  const onSignUpload = async (path, file) => {
    if (file) set(path, await onFileToBase64(file));
  };
  const onPhotosUpload = async (files) => {
    const arr = await Promise.all(
      [...files].map(async (f, i) => ({ id: `${Date.now()}-${i}`, src: await onFileToBase64(f), caption: "" }))
    );
    setForm((p) => ({ ...p, photos: [...p.photos, ...arr] }));
  };
  const updatePhoto = (id, patch) => setForm((p) => ({ ...p, photos: p.photos.map((ph) => (ph.id === id ? { ...ph, ...patch } : ph)) }));
  const deletePhoto = (id) => setForm((p) => ({ ...p, photos: p.photos.filter((ph) => ph.id !== id) }));

  // JSON import/export
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${form.fsrNo}.json`);
  };
  const importJSON = async (file) => {
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      setForm(data);
    } catch (e) {
      alert("Invalid JSON file");
    }
  };

  // High-quality multipage PDF export
  const exportPDF = async () => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

    const node = previewRef.current;
    // Ensure white background
    const canvas = await html2canvas(node, { scale: pdfQuality, useCORS: true, backgroundColor: "#ffffff" });

    const pdf = new jsPDF({ unit: "px", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth; // fit width
    const ratio = imgWidth / canvas.width;
    const imgHeight = canvas.height * ratio;

    // If height fits one page, easy
    if (imgHeight <= pageHeight) {
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, imgHeight, undefined, "FAST");
      pdf.save(`${form.fsrNo}.pdf`);
      return;
    }

    // Slice into multiple A4 pages
    const pageHeightInCanvas = pageHeight / ratio; // height in original canvas pixels per page
    let y = 0;
    while (y < canvas.height) {
      const slice = sliceCanvas(canvas, 0, y, canvas.width, Math.min(pageHeightInCanvas, canvas.height - y));
      const h = slice.height * ratio;
      if (y > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, imgWidth, h, undefined, "FAST");
      y += pageHeightInCanvas;
    }

    pdf.save(`${form.fsrNo}.pdf`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="px-6 py-4 border-b bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">FSR Generator</h1>
            <span className="text-gray-400">•</span>
            <span className="text-sm text-gray-600">{form.fsrNo}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm cursor-pointer px-3 py-2 rounded-lg border hover:bg-gray-100">
              Import JSON
              <input type="file" accept="application/json" className="hidden" onChange={(e) => importJSON(e.target.files?.[0])} />
            </label>
            <button onClick={exportJSON} className="px-3 py-2 rounded-lg border hover:bg-gray-100">Download JSON</button>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border">
              <span className="text-sm">PDF quality</span>
              <input type="range" min={2} max={5} step={1} value={pdfQuality} onChange={(e) => setPdfQuality(+e.target.value)} />
              <span className="text-sm w-5 text-center">{pdfQuality}</span>
            </div>
            <button onClick={exportPDF} className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Export PDF</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid md:grid-cols-2 gap-6 p-6">
        {/* LEFT: FORM */}
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <Section title="Brand & Header" right={<small className="text-gray-500">Logo & identifiers</small>}>
            <Row cols={3}>
              <Input label="SWO No." value={form.swoNo} onChange={(e) => set("swoNo", e.target.value)} />
              <Input label="FSR No." value={form.fsrNo} onChange={(e) => set("fsrNo", e.target.value)} />
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Logo (PNG/JPG)</div>
                <input type="file" accept="image/*" onChange={(e) => onLogoUpload(e.target.files?.[0])} />
              </label>
            </Row>
          </Section>

          <Section title="Customer & System">
            <Row cols={3}>
              <Input label="Customer Name" value={form.customerName} onChange={(e) => set("customerName", e.target.value)} />
              <Input label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} />
              <Input label="Contact Person" value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
            </Row>
            <Row cols={3}>
              <Input label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              <Input label="Modality" value={form.modality} onChange={(e) => set("modality", e.target.value)} />
              <Input label="Model" value={form.model} onChange={(e) => set("model", e.target.value)} />
            </Row>
            <Row cols={3}>
              <Input label="Serial No." value={form.serialNo} onChange={(e) => set("serialNo", e.target.value)} />
              <Input label="Product No." value={form.productNo} onChange={(e) => set("productNo", e.target.value)} />
              <div />
            </Row>
          </Section>

          <Section title="Timing">
            <Row cols={3}>
              <Input type="date" label="Start Travel - Date" value={form.startTravelDate} onChange={(e) => set("startTravelDate", e.target.value)} />
              <Input type="time" label="Start Travel - Time" value={form.startTravelTime} onChange={(e) => set("startTravelTime", e.target.value)} />
              <Input label="Breakdown" value={form.breakdown} onChange={(e) => set("breakdown", e.target.value)} />
            </Row>
            <Row cols={3}>
              <Input type="date" label="Arrived - Date" value={form.arrivedDate} onChange={(e) => set("arrivedDate", e.target.value)} />
              <Input type="time" label="Arrived - Time" value={form.arrivedTime} onChange={(e) => set("arrivedTime", e.target.value)} />
              <div />
            </Row>
            <Row cols={3}>
              <Input type="date" label="Work Start - Date" value={form.workStartDate} onChange={(e) => set("workStartDate", e.target.value)} />
              <Input type="time" label="Work Start - Time" value={form.workStartTime} onChange={(e) => set("workStartTime", e.target.value)} />
              <div />
            </Row>
            <Row cols={3}>
              <Input type="date" label="Work Finish - Date" value={form.workFinishDate} onChange={(e) => set("workFinishDate", e.target.value)} />
              <Input type="time" label="Work Finish - Time" value={form.workFinishTime} onChange={(e) => set("workFinishTime", e.target.value)} />
              <div />
            </Row>
          </Section>

          <Section title="Types">
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-3">
                <div className="font-medium mb-2">Job Type</div>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(form.jobTypes).map(([k, v]) => (
                    <Checkbox key={k} label={labelJobType(k)} checked={v} onChange={(val) => set(`jobTypes.${k}`, val)} />
                  ))}
                </div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="font-medium mb-2">Service Type</div>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(form.serviceTypes).map(([k, v]) => (
                    <Checkbox key={k} label={labelServiceType(k)} checked={v} onChange={(val) => set(`serviceTypes.${k}`, val)} />
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Problem & Action">
            <TextArea label="Problem" value={form.problem} onChange={(e) => set("problem", e.target.value)} />
            <TextArea label="Action" value={form.action} onChange={(e) => set("action", e.target.value)} />
          </Section>

          <Section title="Parts Used">
            {form.parts.map((p, i) => (
              <div key={i} className="grid md:grid-cols-4 gap-3 items-end">
                <Input label="Part Name" value={p.partName} onChange={(e) => set(`parts.${i}.partName`, e.target.value)} />
                <Input label="Part No" value={p.partNo} onChange={(e) => set(`parts.${i}.partNo`, e.target.value)} />
                <Input label="Qty" value={p.qty} onChange={(e) => set(`parts.${i}.qty`, e.target.value)} />
                <div className="flex gap-2">
                  <Input label="Status" value={p.status} onChange={(e) => set(`parts.${i}.status`, e.target.value)} />
                  <button onClick={() => removePart(i)} className="h-10 mt-6 px-3 border rounded-lg">Remove</button>
                </div>
              </div>
            ))}
            <button onClick={addPart} className="px-3 py-2 border rounded-lg">+ Add part</button>
            <Row cols={3}>
              <Input label="Job Status" value={form.jobStatus} onChange={(e) => set("jobStatus", e.target.value)} />
              <Input label="Status (Chargeable/FOC/Borrow)" value={form.statusChargeable} onChange={(e) => set("statusChargeable", e.target.value)} />
              <Input label="Condition When Leave" value={form.conditionWhenLeave} onChange={(e) => set("conditionWhenLeave", e.target.value)} />
            </Row>
          </Section>

          <Section title="Evidence Photos" right={<small className="text-gray-500">Maximize quality for PDF</small>}>
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <label className="text-sm cursor-pointer px-3 py-2 rounded-lg border hover:bg-gray-100">
                Add Photos
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPhotosUpload(e.target.files || [])} />
              </label>
              <span className="text-xs text-gray-500">Tips: upload gambar resolusi tinggi ({">"}= 1600px)</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {form.photos.map((ph) => (
                <div key={ph.id} className="border rounded-lg overflow-hidden">
                  <img src={ph.src} alt="evidence" className="w-full aspect-video object-contain bg-gray-50" />
                  <div className="p-2">
                    <input className="w-full text-sm border rounded px-2 py-1" placeholder="Caption / description" value={ph.caption} onChange={(e) => updatePhoto(ph.id, { caption: e.target.value })} />
                    <div className="text-right mt-2">
                      <button onClick={() => deletePhoto(ph.id)} className="text-xs px-2 py-1 border rounded">Remove</button>
                    </div>
                  </div>
                </div>
              ))}
              {form.photos.length === 0 && <div className="text-sm text-gray-500">No photos uploaded yet.</div>}
            </div>
          </Section>

          <Section title="Signatures">
            <Row cols={2}>
              <Input label="Field Service Engineer" value={form.fseName} onChange={(e) => set("fseName", e.target.value)} />
              <Input label="Trainer / L2" value={form.trainerName} onChange={(e) => set("trainerName", e.target.value)} />
            </Row>
            <Row cols={2}>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">FSE Signature (PNG/JPG)</div>
                <input type="file" accept="image/*" onChange={(e) => onSignUpload("fseSign", e.target.files?.[0])} />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Trainer Signature (PNG/JPG)</div>
                <input type="file" accept="image/*" onChange={(e) => onSignUpload("trainerSign", e.target.files?.[0])} />
              </label>
            </Row>
          </Section>
        </div>

        {/* RIGHT: PREVIEW */}
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div ref={previewRef} className="mx-auto bg-white text-[12px] leading-snug" style={{ width: A4_WIDTH_PX, padding: 24 }}>
            {/* Header block */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {form.logo && <img src={form.logo} className="w-14 h-14 object-contain" />}
                <div>
                  <h2 className="text-lg font-bold">FIELD SERVICE REPORT</h2>
                  <div className="text-xs text-gray-600">{form.fsrNo}</div>
                </div>
              </div>
              <div className="w-[240px] border p-2 rounded">
                <div className="grid grid-cols-3 gap-y-1">
                  <div className="col-span-2 font-semibold">SWO No.</div><div>{form.swoNo}</div>
                  <div className="col-span-3 h-[1px] bg-gray-200 my-1" />

                  <div className="font-semibold">Start Travel</div><div>{form.startTravelDate}</div><div>{form.startTravelTime}</div>
                  <div className="font-semibold">Arrived</div><div>{form.arrivedDate}</div><div>{form.arrivedTime}</div>
                  <div className="font-semibold">Work Start</div><div>{form.workStartDate}</div><div>{form.workStartTime}</div>
                  <div className="font-semibold">Work Finish</div><div>{form.workFinishDate}</div><div>{form.workFinishTime}</div>
                  <div className="font-semibold">Breakdown</div><div className="col-span-2">{form.breakdown}</div>
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 w-[540px]">
              <div className="font-semibold">Customer Name</div><div>{form.customerName}</div>
              <div className="font-semibold">Address</div><div>{form.address}</div>
              <div className="font-semibold">Contact Person</div><div>{form.contactPerson} {form.phone && `(Tel: ${form.phone})`}</div>
              <div className="font-semibold">Modality</div><div>{form.modality}</div>
              <div className="font-semibold">Model</div><div>{form.model}</div>
              <div className="font-semibold">Serial No.</div><div>{form.serialNo}</div>
              <div className="font-semibold">Product No.</div><div>{form.productNo}</div>
            </div>

<div className="mt-3 grid grid-cols-2 gap-3">
  {/* JOB TYPE */}
  <div className="border rounded p-2">
    <div className="font-semibold mb-1">Job type :</div>
    <div className="flex flex-wrap gap-2 text-[11px]">
      {Object.entries(form.jobTypes).map(([k, v]) => (
        <span
          key={k}
          className={clsx(
            // ukuran & layout konsisten untuk export
            "inline-flex items-center h-6 leading-6 px-2 rounded-md border whitespace-nowrap",
            "font-medium tracking-wide select-none",
            // warna solid (tanpa opacity/hover) agar rapi di PDF
            v
              ? "bg-black text-white border-black"
              : "bg-gray-100 text-gray-600 border-gray-400"
          )}
        >
          {labelJobType(k)}
        </span>
      ))}
    </div>
  </div>

  {/* SERVICE TYPE */}
  <div className="border rounded p-2">
    <div className="font-semibold mb-1">Service Type :</div>
    <div className="flex flex-wrap gap-2 text-[11px]">
      {Object.entries(form.serviceTypes).map(([k, v]) => (
        <span
          key={k}
          className={clsx(
            "inline-flex items-center h-6 leading-6 px-2 rounded-md border whitespace-nowrap",
            "font-medium tracking-wide select-none",
            v
              ? "bg-black text-white border-black"
              : "bg-gray-100 text-gray-600 border-gray-400"
          )}
        >
          {labelServiceType(k)}
        </span>
      ))}
    </div>
  </div>
</div>


            <Box title="Problem :">{form.problem}</Box>
            <Box title="Action :">{form.action}</Box>

            <div className="grid grid-cols-2 gap-3">
              <div className="border rounded p-2 min-h-[120px]">
                <div className="font-semibold mb-1">Job status :</div>
                <div>{form.jobStatus}</div>

                <div className="mt-2 font-semibold">Part Used:</div>
                <table className="w-full border mt-1 text-[11px]">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border px-2 py-1 w-10">No</th>
                      <th className="border px-2 py-1">Part Name</th>
                      <th className="border px-2 py-1">Part No</th>
                      <th className="border px-2 py-1 w-10">Qty</th>
                      <th className="border px-2 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.parts.filter(p=>p.partName||p.partNo||p.qty||p.status).map((p, i) => (
                      <tr key={i}>
                        <td className="border px-2 py-1 text-center">{i + 1}</td>
                        <td className="border px-2 py-1">{p.partName}</td>
                        <td className="border px-2 py-1">{p.partNo}</td>
                        <td className="border px-2 py-1 text-center">{p.qty}</td>
                        <td className="border px-2 py-1">{p.status}</td>
                      </tr>
                    ))}
                    {form.parts.filter(p=>p.partName||p.partNo||p.qty||p.status).length === 0 && (
                      <tr><td className="border px-2 py-1 text-center" colSpan={5}>-</td></tr>
                    )}
                  </tbody>
                </table>

                <div className="mt-2">Status : <span className="font-semibold">{form.statusChargeable}</span></div>
              </div>

              <div className="border rounded p-2 min-h-[120px]">
                <div className="font-semibold mb-1">CONDITION WHEN LEAVE :</div>
                <div className="whitespace-pre-wrap">{form.conditionWhenLeave}</div>
              </div>
            </div>

            {/* Photo gallery */}
            {form.photos.length > 0 && (
              <div className="border rounded p-2 my-3">
                <div className="font-semibold mb-2">Evidence Photos</div>
                <div className="grid grid-cols-2 gap-3">
                  {form.photos.map((ph, i) => (
                    <div key={ph.id} className="border rounded overflow-hidden">
                      <img src={ph.src} className="w-full aspect-video object-contain bg-gray-50" />
                      {ph.caption && <div className="px-2 py-1 text-[11px]">{i+1}. {ph.caption}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signatures */}
            <div className="mt-10 grid grid-cols-2 gap-10 text-center">
              <div>
                <div className="h-20 flex items-center justify-center">{form.fseSign && <img src={form.fseSign} className="max-h-16 object-contain" />}</div>
                <div className="border-t pt-2">{form.fseName || "Field Service Engineer"}</div>
              </div>
              <div>
                <div className="h-20 flex items-center justify-center">{form.trainerSign && <img src={form.trainerSign} className="max-h-16 object-contain" />}</div>
                <div className="border-t pt-2">{form.trainerName || "Trainer / L2"}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function labelJobType(k) {
  return { siteSurvey: "Site Survey", training: "Training", corrective: "Corrective Maintenance", installation: "Installation", update: "Update", preventive: "Preventive Maintenance" }[k] || k;
}
function labelServiceType(k) {
  return { chargeable: "Chargeable", contract: "Contract Service", warranty: "Warranty" }[k] || k;
}
function Box({ title, children }) {
  return (
    <div className="border rounded p-2 my-3 min-h-[120px]">
      <div className="font-semibold mb-2">{title}</div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sliceCanvas(sourceCanvas, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}