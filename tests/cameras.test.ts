import { describe, expect, it } from "vitest";
import {
  CAMERA_SOURCES,
  atxRows,
  bcRows,
  caltransRows,
  cgyRows,
  dgtRows,
  fiRows,
  hkRows,
  iaRows,
  ilRows,
  isRows,
  kyRows,
  nycRows,
  qldRows,
  sdRows,
  sgRows,
  tflRows,
  toRows,
  wsdotRows,
  skylineRows,
  mdRows,
  deRows,
  moRows,
  carsRows,
  alRows,
  okRows,
  isLiveVideo,
  type CameraRow,
} from "@/layers/cameras";

const idx = (id: string) => CAMERA_SOURCES.findIndex((s) => s.id === id);
const pt = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });

describe("camera sources", () => {
  it("have unique ids, https homepages and a licence", () => {
    expect(new Set(CAMERA_SOURCES.map((s) => s.id)).size).toBe(CAMERA_SOURCES.length);
    for (const s of CAMERA_SOURCES) {
      expect(s.homepage).toMatch(/^https:\/\//);
      expect(s.license.length).toBeGreaterThan(5);
      expect(s.refreshSec).toBeGreaterThan(0);
    }
  });
});

describe("existing parsers", () => {
  it("tflRows keeps available cameras with https media", () => {
    const prop = (img: string, available = "true") => [
      { key: "available", value: available },
      { key: "imageUrl", value: img },
      { key: "videoUrl", value: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.mp4" },
    ];
    const rows = tflRows([
      { id: "JamCams_1", commonName: "A1 / Holloway Rd", lat: 51.55, lon: -0.12, additionalProperties: prop("https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.jpg") },
      { id: "JamCams_2", commonName: "Off", lat: 51.5, lon: -0.1, additionalProperties: prop("https://x/2.jpg", "false") },
      { id: "JamCams_3", commonName: "Http", lat: 51.5, lon: -0.1, additionalProperties: prop("http://x/3.jpg") },
    ]);
    expect(rows).toEqual([["tfl:JamCams_1", "A1 / Holloway Rd", -0.12, 51.55, idx("tfl"), "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.jpg", "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.mp4", "mp4"]]);
  });

  it("nycRows keeps online cameras", () => {
    const rows = nycRows([
      { id: "a", name: "Broadway @ 42 St", latitude: 40.75, longitude: -73.98, isOnline: "true", imageUrl: "https://webcams.nyctmc.org/api/cameras/a/image" },
      { id: "b", name: "Offline", latitude: 40.7, longitude: -73.9, isOnline: "false", imageUrl: "https://webcams.nyctmc.org/api/cameras/b/image" },
    ]);
    expect(rows).toEqual([["nyc:a", "Broadway @ 42 St", -73.98, 40.75, idx("nyc"), "https://webcams.nyctmc.org/api/cameras/a/image", null, null]]);
  });

  it("caltransRows keeps in-service cameras, strips the route prefix and adds HLS", () => {
    const cam = (index: string, inService: string, img?: string) => ({
      cctv: {
        index,
        inService,
        location: { district: "4", locationName: "TVD32 -- I-80 : Bay Bridge Toll Plaza", latitude: "37.825", longitude: "-122.31" },
        imageData: { streamingVideoURL: "https://wzmedia.dot.ca.gov/D4/W80_at_Toll_Plaza.stream/playlist.m3u8", static: { currentImageURL: img } },
      },
    });
    const rows = caltransRows([cam("1", "true", "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tvd32/tvd32.jpg"), cam("2", "false", "https://x/2.jpg"), cam("3", "true")]);
    expect(rows).toEqual([["caltrans:4:1", "I-80 : Bay Bridge Toll Plaza", -122.31, 37.825, idx("caltrans"), "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tvd32/tvd32.jpg", "https://wzmedia.dot.ca.gov/D4/W80_at_Toll_Plaza.stream/playlist.m3u8", "hls"]]);
  });

  it("hkRows reads the tab-separated list and drops the bracketed district", () => {
    const tsv = "﻿key\tregion\tdistrict\tdescription\teasting\tnorthing\tlatitude\tlongitude\turl\r\n" +
      "H210F\tHK Island\tCentral\tHarcourt Road [H210F]\t834000\t816000\t22.2799\t114.1650\thttps://tdcctv.data.one.gov.hk/H210F.JPG\r\n" +
      "BAD\tx\tx\tNo coords\t0\t0\t\t\thttps://tdcctv.data.one.gov.hk/BAD.JPG\r\n";
    expect(hkRows(tsv)).toEqual([["hk:H210F", "Harcourt Road", 114.165, 22.2799, idx("hk"), "https://tdcctv.data.one.gov.hk/H210F.JPG", null, null]]);
  });

  it("fiRows uses the first collected preset of gathering stations", () => {
    const rows = fiRows({
      features: [
        { id: "C01502", geometry: { coordinates: [24.9, 60.2, 0] }, properties: { name: "vt1_Helsinki_Konala", collectionStatus: "GATHERING", presets: [{ id: "C0150201", inCollection: false }, { id: "C0150202" }] } },
        { id: "C09999", geometry: { coordinates: [25, 61] }, properties: { name: "Removed", collectionStatus: "REMOVED_TEMPORARILY", presets: [{ id: "C0999901" }] } },
      ],
    });
    expect(rows).toEqual([["fi:C0150202", "Helsinki Konala", 24.9, 60.2, idx("fi"), "https://weathercam.digitraffic.fi/C0150202.jpg", null, null]]);
  });

  it("sgRows reads the latest snapshot set", () => {
    const rows = sgRows({ items: [{ cameras: [{ camera_id: "1701", image: "https://images.data.gov.sg/api/traffic-images/1701.jpg", location: { latitude: 1.32, longitude: 103.87 } }] }] });
    expect(rows).toEqual([["sg:1701", "Traffic camera 1701", 103.87, 1.32, idx("sg"), "https://images.data.gov.sg/api/traffic-images/1701.jpg", null, null]]);
  });
});

describe("new parsers", () => {
  it("dgtRows parses DATEX II cameras", () => {
    const device = (id: string, type: string, url: string, lat = "42.2624") => `
      <ns2:device xsi:type="fse:ExtendedDevice" id="${id}" version="2">
        <ns2:typeOfDevice>${type}</ns2:typeOfDevice>
        <ns2:pointLocation><loc:supplementaryPositionalDescription><loc:roadInformation>
          <loc:roadDestination>BURGOS</loc:roadDestination><loc:roadName>A-62</loc:roadName>
        </loc:roadInformation></loc:supplementaryPositionalDescription>
        <loc:pointCoordinates><loc:latitude>${lat}</loc:latitude><loc:longitude>-3.9403</loc:longitude></loc:pointCoordinates>
        <lse:kilometerPoint>25.3</lse:kilometerPoint><lse:province>SAN SEBASTIÁN</lse:province></ns2:pointLocation>
        <fse:deviceUrl>${url}</fse:deviceUrl>
      </ns2:device>`;
    const xml = `<d2:payload>${device("176130", "camera", "https://etraffic.dgt.es/camarasEtraffic/176130.jpg")}${device("1", "camera", "http://x/1.jpg")}${device("2", "sign", "https://x/2.jpg")}${device("3", "camera", "https://x/3.jpg", "")}</d2:payload>`;
    expect(dgtRows(xml)).toEqual([["dgt:176130", "A-62 km 25.3, San Sebastián", -3.9403, 42.2624, idx("dgt"), "https://etraffic.dgt.es/camarasEtraffic/176130.jpg", null, null]]);
  });

  it("ilRows skips snapshots flagged too old and names the direction", () => {
    const f = (id: string, dir: string, tooOld: string) => ({
      geometry: pt(-87.9148, 41.886),
      properties: { ImgPath: `https://travelmidwest.com/showCamera?id=${id}&direction=${dir}`, CameraLocation: "Hillside Tower Camera 9", CameraDirection: dir, SnapShot: `https://cctv.travelmidwest.com/snapshots/${id}_${dir}.jpg`, TooOld: tooOld },
    });
    const rows = ilRows({ features: [f("IL-A", "NONE", "false"), f("IL-B", "E", "false"), f("IL-C", "W", "true"), f("IL-A", "NONE", "false")] });
    expect(rows).toEqual([
      ["il:IL-A", "Hillside Tower Camera 9", -87.9148, 41.886, idx("il"), "https://cctv.travelmidwest.com/snapshots/IL-A_NONE.jpg", null, null],
      ["il:IL-B:E", "Hillside Tower Camera 9 (E)", -87.9148, 41.886, idx("il"), "https://cctv.travelmidwest.com/snapshots/IL-B_E.jpg", null, null],
    ]);
  });

  it("wsdotRows keeps WSDOT and TripCheck frames only", () => {
    const f = (id: number, url: string) => ({ geometry: pt(-122.67, 45.66), properties: { OBJECTID: id, CameraTitle: "I-5 at MP 3.2: Main St ", ImageURL: url } });
    const rows = wsdotRows({ features: [f(1003, "https://images.wsdot.wa.gov/sw/005vc00320.jpg"), f(1001, "https://www.tripcheck.com/RoadCams/cams/x.jpg"), f(9, "https://cam.pangbornairport.com/x.jpg"), f(10, "http://images.wsdot.wa.gov/x.jpg")] });
    expect(rows.map((r) => r[0])).toEqual(["wsdot:1003", "wsdot:1001"]);
    expect(rows[0]).toEqual(["wsdot:1003", "I-5 at MP 3.2: Main St", -122.67, 45.66, idx("wsdot"), "https://images.wsdot.wa.gov/sw/005vc00320.jpg", null, null]);
  });

  it("iaRows adds HLS streams and de-duplicates images", () => {
    const f = (img: string, vid: string | null) => ({ geometry: pt(-92.4, 42.5), properties: { Desc_: "US 20 @ Hudson Rd", ImageURL: img, VideoURL: vid } });
    const rows = iaRows({ features: [f("https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/wltv06hd.jpeg", "https://video4.iowadot.gov:8888/waterloo/wltv06lb/playlist.m3u8"), f("https://atmsqf.iowadot.gov/snapshots/public/Metro/WLTV06HD.jpeg", null), f("https://atmsqf.iowadot.gov/x/rwis_1.jpg", "https://example.gov/page.html")] });
    expect(rows).toEqual([
      ["ia:wltv06hd", "US 20 @ Hudson Rd", -92.4, 42.5, idx("ia"), "https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/wltv06hd.jpeg", "https://video4.iowadot.gov:8888/waterloo/wltv06lb/playlist.m3u8", "hls"],
      ["ia:rwis_1", "US 20 @ Hudson Rd", -92.4, 42.5, idx("ia"), "https://atmsqf.iowadot.gov/x/rwis_1.jpg", null, null],
    ]);
  });

  it("bcRows keeps cameras that are on and not stale", () => {
    const c = (id: number, extra: object = {}) => ({ id, name: "Lougheed at 272 Street - SW", is_on: true, should_appear: true, marked_stale: false, location: pt(-122.476, 49.173), ...extra });
    const rows = bcRows([c(1174), c(2, { is_on: false }), c(3, { marked_stale: true }), c(4, { should_appear: false })]);
    expect(rows).toEqual([["bc:1174", "Lougheed at 272 Street - SW", -122.476, 49.173, idx("bc"), "https://www.drivebc.ca/images/1174.jpg", null, null]]);
  });

  it("isRows uses the view description and the image file as id", () => {
    const rows = isRows([
      { Myndavel: "Hellisheiði", Skyring: "Hellisheiði séð til vesturs", Slod: "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg", Breidd: 64.018296, Lengd: -21.342636 },
      { Myndavel: "Hellisheiði", Skyring: "", Slod: "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_2.jpg", Breidd: 64.018296, Lengd: -21.342636 },
      { Myndavel: "Dup", Slod: "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_2.jpg", Breidd: 64, Lengd: -21 },
    ]);
    expect(rows).toEqual([
      ["is:hellisheidi_1", "Hellisheiði séð til vesturs", -21.342636, 64.018296, idx("is"), "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg", null, null],
      ["is:hellisheidi_2", "Hellisheiði", -21.342636, 64.018296, idx("is"), "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_2.jpg", null, null],
    ]);
  });

  it("toRows reads MultiPoint features and title-cases street names", () => {
    const rows = toRows({ features: [
      { geometry: { type: "MultiPoint", coordinates: [[-79.3813, 43.6431]] }, properties: { REC_ID: 8001, IMAGEURL: "https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc8001.jpg", MAINROAD: "YORK ST", CROSSROAD: "BREMNER BLVD / RAPTORS WAY" } },
      { geometry: null, properties: { REC_ID: 8002, IMAGEURL: "https://x/loc8002.jpg" } },
    ] });
    expect(rows).toEqual([["to:8001", "York St & Bremner Blvd / Raptors Way", -79.3813, 43.6431, idx("to"), "https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc8001.jpg", null, null]]);
  });

  it("cgyRows upgrades Calgary's own image host to https and drops other http links", () => {
    const rows = cgyRows([
      { camera_url: { url: "http://trafficcam.calgary.ca/loc86.jpg" }, camera_location: "Stoney Trail / Deerfoot Trail SE", point: pt(-113.9766, 50.9007) },
      { camera_url: { url: "http://elsewhere.example/loc1.jpg" }, camera_location: "Other", point: pt(-114, 51) },
    ]);
    expect(rows).toEqual([["cgy:loc86", "Stoney Trail / Deerfoot Trail SE", -113.9766, 50.9007, idx("cgy"), "https://trafficcam.calgary.ca/loc86.jpg", null, null]]);
  });

  it("kyRows keeps https snapshots only", () => {
    const rows = kyRows({ features: [
      { geometry: pt(-85.5612, 38.3202), properties: { description: "I-71 at Old Brownsboro Rd", snapshot: "https://www.trimarc.org/images/milestone/CCTV_05_71_0103.jpg" } },
      { geometry: pt(-85.75, 38.34), properties: { description: "I-65 Indiana", snapshot: "http://pws.trafficwise.org/pullover/172.jpg" } },
    ] });
    expect(rows).toEqual([["ky:CCTV_05_71_0103", "I-71 at Old Brownsboro Rd", -85.5612, 38.3202, idx("ky"), "https://www.trimarc.org/images/milestone/CCTV_05_71_0103.jpg", null, null]]);
  });

  it("qldRows reads the QLDTraffic webcam GeoJSON", () => {
    const rows = qldRows({ features: [
      { geometry: pt(153.0086975, -27.5551796), properties: { id: 1, description: "Archerfield - Ipswich Motorway & Granard Rd - North ", image_url: "https://cameras.qldtraffic.qld.gov.au/Metropolitan/Archerfield_Ipswich_Mwy_sth.jpg" } },
      { geometry: pt(153, -27.5), properties: { id: 2, description: "Http", image_url: "http://x/2.jpg" } },
    ] });
    expect(rows).toEqual([["qld:1", "Archerfield - Ipswich Motorway & Granard Rd - North", 153.0086975, -27.5551796, idx("qld"), "https://cameras.qldtraffic.qld.gov.au/Metropolitan/Archerfield_Ipswich_Mwy_sth.jpg", null, null]]);
  });

  it("atxRows keeps cameras that are turned on and title-cases the location", () => {
    const c = (id: string, status: string) => ({ camera_id: id, location_name: " BRODIE LN / ERNEST ROBLES WAY", camera_status: status, screenshot_address: `https://cctv.austinmobility.io/image/${id}.jpg`, location: pt(-97.820351, 30.229502) });
    const rows = atxRows([c("1", "TURNED_ON"), c("670", "DESIRED"), c("3", "REMOVED")]);
    expect(rows).toEqual([["atx:1", "Brodie Ln / Ernest Robles Way", -97.820351, 30.229502, idx("atx"), "https://cctv.austinmobility.io/image/1.jpg", null, null]]);
  });

  it("sdRows expands each site into its camera views", () => {
    const rows = sdRows({ features: [
      { geometry: pt(-97.06, 44.95), properties: { name: "Watertown North", route: "I-29", cameras: [
        { id: "1", name: "Camera Looking South", image: "https://sd.cdn.iteris-atis.com/camera_images/CSDATY/1/latest.jpg" },
        { id: "4", name: "Road Surface View", image: "https://sd.cdn.iteris-atis.com/camera_images/CSDATY/4/latest.jpg" },
        { id: "9", name: "Http", image: "http://x/9.jpg" },
      ] } },
      { geometry: null, properties: { name: "No location", cameras: [{ image: "https://sd.cdn.iteris-atis.com/camera_images/X/0/latest.jpg" }] } },
    ] });
    expect(rows).toEqual([
      ["sd:CSDATY:1", "I-29 Watertown North: Camera Looking South", -97.06, 44.95, idx("sd"), "https://sd.cdn.iteris-atis.com/camera_images/CSDATY/1/latest.jpg", null, null],
      ["sd:CSDATY:4", "I-29 Watertown North: Road Surface View", -97.06, 44.95, idx("sd"), "https://sd.cdn.iteris-atis.com/camera_images/CSDATY/4/latest.jpg", null, null],
    ]);
  });

  it("every parser rejects missing or zero coordinates", () => {
    const zero: CameraRow[] = [
      ...bcRows([{ id: 1, name: "x", is_on: true, location: pt(0, 0) }]),
      ...isRows([{ Slod: "https://x/a.jpg", Breidd: 0, Lengd: 0 }]),
      ...wsdotRows({ features: [{ geometry: null, properties: { ImageURL: "https://images.wsdot.wa.gov/a.jpg" } }] }),
      ...qldRows({ features: [{ geometry: pt(0, 0), properties: { id: 1, image_url: "https://x/a.jpg" } }] }),
      ...atxRows([{ camera_id: "1", camera_status: "TURNED_ON", screenshot_address: "https://x/a.jpg" }]),
    ];
    expect(zero).toEqual([]);
  });
});

describe("live-video sources", () => {
  it("caltransRows repairs District 8 http / 'ttps' stream links to https", () => {
    const cam = (index: string, vid: string) => ({
      cctv: { index, inService: "true", location: { district: "8", locationName: "I-10 : Rte 210", latitude: "34.06", longitude: "-117.6" }, imageData: { streamingVideoURL: vid, static: { currentImageURL: `https://cwwp2.dot.ca.gov/data/d8/cctv/image/${index}.jpg` } } },
    });
    const rows = caltransRows([cam("1", "ttps://wzmedia.dot.ca.gov/D8/LB10_at_Rte_210.stream/playlist.m3u8"), cam("2", "http://wzmedia.dot.ca.gov/D8/X.stream/playlist.m3u8"), cam("3", "http://other.example/x.m3u8")]);
    expect(rows.map((r) => r[6])).toEqual(["https://wzmedia.dot.ca.gov/D8/LB10_at_Rte_210.stream/playlist.m3u8", "https://wzmedia.dot.ca.gov/D8/X.stream/playlist.m3u8", null]);
    expect(rows.map((r) => r[7])).toEqual(["hls", "hls", null]);
  });

  it("skylineRows reads VDOT / SC511 features and skips inactive or problem streams", () => {
    const f = (id: string, extra: object = {}) => ({
      geometry: pt(-77.3055, 38.84519),
      properties: { id, name: `cam${id}`, description: "University Drive and Sager Avenue", https_url: `https://media-sfs7.vdotcameras.com/rtplive/cam${id}/playlist.m3u8`, image_url: `https://snapshot.vdotcameras.com/thumbs/cam${id}.flv.png`, active: true, problem_stream: false, ...extra },
    });
    const rows = skylineRows([f("1"), f("2", { active: false }), f("3", { problem_stream: true }), f("4", { https_url: "rtmp://x/y" }), f("5", { https_url: "", image_url: "" })], "va");
    expect(rows).toEqual([
      ["va:1", "University Drive and Sager Avenue", -77.3055, 38.84519, idx("va"), "https://snapshot.vdotcameras.com/thumbs/cam1.flv.png", "https://media-sfs7.vdotcameras.com/rtplive/cam1/playlist.m3u8", "hls"],
      ["va:4", "University Drive and Sager Avenue", -77.3055, 38.84519, idx("va"), "https://snapshot.vdotcameras.com/thumbs/cam4.flv.png", null, null],
    ]);
    expect(skylineRows([f("9")], "sc")[0][4]).toBe(idx("sc"));
  });

  it("mdRows builds CHART stream URLs (video only) and skips offline cameras", () => {
    const c = (id: string, extra: object = {}) => ({ id, name: "710002", description: "I-70 East of I-270", lat: 39.39761, lon: -77.42188, cctvIp: "strmr5.sha.maryland.gov", commMode: "ONLINE", opStatus: "OK", ...extra });
    const rows = mdRows([c("9201ff58"), c("aa", { commMode: "OFFLINE" }), c("bb", { opStatus: "COMM_FAILURE" }), c("cc", { cctvIp: "evil.example.com" }), c("../x"), c("dd", { opStatus: "COMM_MARGINAL" })]);
    expect(rows).toEqual([
      ["md:9201ff58", "I-70 East of I-270", -77.42188, 39.39761, idx("md"), "", "https://strmr5.sha.maryland.gov/rtplive/9201ff58/playlist.m3u8", "hls"],
      ["md:dd", "I-70 East of I-270", -77.42188, 39.39761, idx("md"), "", "https://strmr5.sha.maryland.gov/rtplive/dd/playlist.m3u8", "hls"],
    ]);
  });

  it("deRows keeps enabled, active DelDOT cameras with an https stream", () => {
    const c = (id: string, extra: object = {}) => ({ id, title: "DE 1 @ MILFORD NECK ROAD (NORTH OFF)", lat: 38.990931, lon: -75.448625, enabled: true, status: "Active", urls: { m3u8s: `https://video.deldot.gov:443/live/${id}.stream/playlist.m3u8` }, ...extra });
    const rows = deRows({ videoCameras: [c("KCAM001"), c("KCAM002", { status: "Unavailable" }), c("KCAM003", { enabled: false }), c("KCAM004", { urls: { m3u8s: "" } })] });
    expect(rows).toEqual([["de:KCAM001", "De 1 @ Milford Neck Road (North Off)", -75.448625, 38.990931, idx("de"), "", "https://video.deldot.gov:443/live/KCAM001.stream/playlist.m3u8", "hls"]]);
  });

  it("moRows keeps MoDOT and Ozarks Traffic streams, skipping KC Scout relays", () => {
    const rows = moRows([
      { location: "141 AT 21, MM 27.1", x: -90.424496, y: 38.4623, html: "https://sfs02-traveler.modot.mo.gov/rtplive/MODOT_CAM_209/playlist.m3u8" },
      { location: "Glenstone at Sunshine", x: -93.26, y: 37.18, html: "https://S2.ozarkstrafficoneview.com/rtplive/CAM104/playlist.m3u8" },
      { location: "I-435 NB", x: -94.5, y: 39.0, html: "https://traveler.modot.org/tisvc/api/Tms/CameraStream/K435NBC-41-LQ" },
      { location: "No stream", x: -92, y: 38, html: null },
    ]);
    expect(rows).toEqual([
      ["mo:MODOT_CAM_209", "141 AT 21, MM 27.1", -90.424496, 38.4623, idx("mo"), "", "https://sfs02-traveler.modot.mo.gov/rtplive/MODOT_CAM_209/playlist.m3u8", "hls"],
      ["mo:oz:CAM104", "Glenstone at Sunshine", -93.26, 37.18, idx("mo"), "", "https://s2.ozarkstrafficoneview.com/rtplive/CAM104/playlist.m3u8", "hls"],
    ]);
  });

  it("carsRows expands views: HLS with preview still, plain stills, token streams as stills only", () => {
    const loc = { latitude: 39.703969, longitude: -105.704145 };
    const rows = carsRows([
      { id: 14336, public: true, active: true, name: "I-70 MP 227.00 EB", location: loc, views: [{ name: "I-70 MP 227.00 EB", type: "WMP", url: "https://publicstreamer4.cotrip.org:443/rtplive/070E22700CAM1RHS/playlist.m3u8", videoPreviewUrl: "https://cocam.carsprogram.org/Snapshots/070E22700CAM1RHS.flv.png" }] },
      { id: 2, name: "US 285 at CO 17", location: loc, views: [{ name: "Looking South", type: "STILL_IMAGE", url: "https://cocam.carsprogram.org/a.jpg" }, { name: "Looking North", type: "STILL_IMAGE", url: "http://x/b.jpg" }] },
      { id: 3, name: "K-96", location: loc, views: [{ type: "WMP", url: "https://kdot-sfs2.us-east-1.skyvdn.com/rtplive/1/playlist.m3u8?token=abc", videoPreviewUrl: "https://kscam.carsprogram.org/1.jpg" }] },
      { id: 4, name: "Relay", location: loc, views: [{ type: "MJPEG", url: "https://api.example.com/stream?key=1", videoPreviewUrl: "https://x/4.jpg" }] },
      { id: 5, active: false, name: "Inactive", location: loc, views: [{ type: "STILL_IMAGE", url: "https://x/5.jpg" }] },
    ], "co");
    expect(rows).toEqual([
      ["co:14336:0", "I-70 MP 227.00 EB", -105.704145, 39.703969, idx("co"), "https://cocam.carsprogram.org/Snapshots/070E22700CAM1RHS.flv.png", "https://publicstreamer4.cotrip.org:443/rtplive/070E22700CAM1RHS/playlist.m3u8", "hls"],
      ["co:2:0", "US 285 at CO 17: Looking South", -105.704145, 39.703969, idx("co"), "https://cocam.carsprogram.org/a.jpg", null, null],
      ["co:3:0", "K-96", -105.704145, 39.703969, idx("co"), "https://kscam.carsprogram.org/1.jpg", null, null],
    ]);
  });

  it("alRows keeps public ALGO cameras with stream and snapshot", () => {
    const c = (id: number, accessLevel = "Public") => ({ id, accessLevel, location: { latitude: 30.535105, longitude: -88.23953, city: "Mobile", displayRouteDesignator: "I-10", displayCrossStreet: "McDonald Rd" }, playbackUrls: { hls: `https://cdn3.wowza.com/5/x/mobile-fastly/mob-cam-${id}.stream/playlist.m3u8` }, snapshotImageUrl: `https://api.algotraffic.com/v4/Cameras/${id}/snapshot.jpg` });
    const rows = alRows([c(1845), c(2, "FirstResponder")]);
    expect(rows).toEqual([["al:1845", "I-10 at McDonald Rd, Mobile", -88.23953, 30.535105, idx("al"), "https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg", "https://cdn3.wowza.com/5/x/mobile-fastly/mob-cam-1845.stream/playlist.m3u8", "hls"]]);
  });

  it("okRows flattens poles and skips out-of-service or blocked cameras", () => {
    const m = (id: number, extra: object = {}) => ({ id, location: "I-44 & I-240 A", latitude: "35.39637", longitude: "-97.57406", status: "Free", blockAtis: "0", streamDictionary: { streamSrc: `https://stream.oktraffic.org/delay-stream/${id}.stream/playlist.m3u8` }, ...extra });
    const rows = okRows([{ mapCameras: [m(1), m(2, { status: "Out Of Service" }), m(3, { blockAtis: "1" }), m(4, { streamDictionary: null })] }, {}]);
    expect(rows).toEqual([["ok:1", "I-44 & I-240 A", -97.57406, 35.39637, idx("ok"), "", "https://stream.oktraffic.org/delay-stream/1.stream/playlist.m3u8", "hls"]]);
  });

  it("video-only rows are always live HLS; MP4 clips are not live", () => {
    const rows = [
      ...mdRows([{ id: "ab", lat: 39, lon: -77, cctvIp: "strmr3.sha.maryland.gov", commMode: "ONLINE", opStatus: "OK" }]),
      ...okRows([{ mapCameras: [{ id: 1, latitude: 35, longitude: -97, streamDictionary: { streamSrc: "https://stream.oktraffic.org/delay-stream/a.stream/playlist.m3u8" } }] }]),
    ];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r[5]).toBe("");
      expect(isLiveVideo(r)).toBe(true);
    }
    expect(isLiveVideo(["x", "x", 0, 0, 0, "https://a/b.jpg", "https://a/b.mp4", "mp4"])).toBe(false);
  });
});
