"use client";
/**
 * "Photos here": geotagged Wikimedia Commons files within 1 km and Panoramax
 * street-level pictures within ~300 m of the drop-in point. Both APIs are
 * keyless and CORS-enabled, so the browser fetches them directly (only while
 * dropped in); each thumbnail credits its author and licence and links to its page.
 */
import { useEffect, useState } from "react";
import { commonsGeosearchUrl, formatDistance, PHOTO_USER_AGENT, panoramaxSearchUrl, parseCommons, parsePanoramax, type NearbyPhoto } from "./logic";

interface PhotoState {
  key: string;
  commons: NearbyPhoto[] | null;
  panoramax: NearbyPhoto[] | null;
  error: string | null;
}

export function DropInPhotos({ lat, lon, panelOpen = false }: { lat: number; lon: number; panelOpen?: boolean }) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const [st, setSt] = useState<PhotoState | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const origin = { lat, lon };
    const get = (url: string, headers?: Record<string, string>) =>
      fetch(url, { signal: ctrl.signal, headers }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      });
    // Wait for the fly-down to settle a little so the photo requests don't compete with tiles.
    const t = setTimeout(() => {
      get(commonsGeosearchUrl(lat, lon, 1000), { "Api-User-Agent": PHOTO_USER_AGENT })
        .then((b) => setSt((s) => ({ ...(s?.key === key ? s : blank(key)), commons: parseCommons(b, origin) })))
        .catch((e: Error) => {
          if (e.name !== "AbortError") setSt((s) => ({ ...(s?.key === key ? s : blank(key)), commons: [], error: "Wikimedia Commons unavailable" }));
        });
      get(panoramaxSearchUrl(lat, lon, 300))
        .then((b) => setSt((s) => ({ ...(s?.key === key ? s : blank(key)), panoramax: parsePanoramax(b, origin) })))
        .catch((e: Error) => {
          if (e.name !== "AbortError") setSt((s) => ({ ...(s?.key === key ? s : blank(key)), panoramax: [] }));
        });
    }, 900);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [lat, lon, key]);

  const cur = st?.key === key ? st : null;
  const photos = [...(cur?.panoramax ?? []).slice(0, 6), ...(cur?.commons ?? [])];
  const loading = !cur || cur.commons === null || cur.panoramax === null;

  return (
    <div
      className={`glass pointer-events-auto absolute bottom-[150px] left-3 z-10 rounded-md ${panelOpen ? "w-[min(640px,calc(100%-436px))]" : "w-[min(640px,calc(100%-80px))]"} px-2.5 py-2 shadow-2xl shadow-black/50`}
      data-dropin-photos
      role="region"
      aria-label="Photos near this place"
    >
      <div className="flex items-baseline justify-between gap-2">
        <button className="text-[12.5px] font-semibold text-fg" onClick={() => setOpen(!open)} aria-expanded={open}>
          Photos here {photos.length ? <span className="meta normal-case tracking-normal text-faint">· {photos.length}</span> : null}{" "}
          <span className="text-faint">{open ? "▾" : "▸"}</span>
        </button>
        <span className="meta truncate normal-case tracking-normal text-faint">
          {loading ? "Loading…" : photos.length ? "Wikimedia Commons · Panoramax — click for the file page" : (cur?.error ?? "No geotagged photos within 1 km")}
        </span>
      </div>
      {open && photos.length > 0 && (
        <div className="scroll-thin mt-1.5 flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <a
              key={p.id}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group w-[132px] shrink-0"
              title={`${p.title}\n${p.credit}`}
            >
              <div className="relative h-[84px] w-[132px] overflow-hidden rounded border border-line bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnails from Commons / Panoramax, sized by the API */}
                <img src={p.thumb} alt={p.title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition group-hover:scale-105" />
                <span className="meta absolute right-1 bottom-1 rounded bg-black/65 px-1 normal-case tracking-normal text-white">
                  {p.source === "panoramax" ? "street · " : ""}
                  {formatDistance(p.distanceM)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-fg">{p.title}</div>
              <div className="meta truncate normal-case tracking-normal text-faint">{p.credit}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const blank = (key: string): PhotoState => ({ key, commons: null, panoramax: null, error: null });
