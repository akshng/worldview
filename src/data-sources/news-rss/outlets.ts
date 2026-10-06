import type { Outlet } from "./types";

/**
 * World and regional desks of established outlets with public RSS/Atom feeds (no key, no
 * paywall on the feed). Headlines, short summaries and links only. Balanced by region so the
 * map is not seen only through Western desks. `home` marks a national outlet whose own
 * towns and provinces are recognised in its headlines (it never invents a place).
 * Reuters and AP publish no public RSS; feeds rejected when probed are listed in
 * docs/DATA_SOURCES.md.
 */
export const OUTLETS: Outlet[] = [
  // Global desks
  { id: "bbc", name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", homepage: "https://www.bbc.com/news/world", region: "global" },
  { id: "aljazeera", name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", homepage: "https://www.aljazeera.com/", region: "global" },
  { id: "npr", name: "NPR", url: "https://feeds.npr.org/1004/rss.xml", homepage: "https://www.npr.org/sections/world/", region: "global" },
  { id: "dw", name: "Deutsche Welle", url: "https://rss.dw.com/rdf/rss-en-world", homepage: "https://www.dw.com/en/world/", region: "global" },
  { id: "france24", name: "France 24", url: "https://www.france24.com/en/rss", homepage: "https://www.france24.com/en/", region: "global" },
  { id: "un", name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", homepage: "https://news.un.org/en/", region: "global" },
  { id: "guardian", name: "The Guardian", url: "https://www.theguardian.com/world/rss", homepage: "https://www.theguardian.com/world", region: "global" },
  { id: "cnbc", name: "CNBC", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html", homepage: "https://www.cnbc.com/world/", region: "global" },
  { id: "sky", name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", homepage: "https://news.sky.com/world", region: "global" },
  { id: "abc-au", name: "ABC News (Australia)", url: "https://www.abc.net.au/news/feed/2942460/rss.xml", homepage: "https://www.abc.net.au/news", region: "global" },
  // Asia
  { id: "scmp", name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed", homepage: "https://www.scmp.com/", region: "asia", home: "HK" },
  { id: "japantimes", name: "The Japan Times", url: "https://www.japantimes.co.jp/feed/", homepage: "https://www.japantimes.co.jp/", region: "asia", home: "JP" },
  { id: "thehindu", name: "The Hindu", url: "https://www.thehindu.com/news/national/feeder/default.rss", homepage: "https://www.thehindu.com/news/national/", region: "asia", home: "IN" },
  { id: "toi", name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms", homepage: "https://timesofindia.indiatimes.com/world", region: "asia", home: "IN" },
  { id: "dawn", name: "Dawn", url: "https://www.dawn.com/feeds/home", homepage: "https://www.dawn.com/", region: "asia", home: "PK" },
  { id: "straitstimes", name: "The Straits Times", url: "https://www.straitstimes.com/news/asia/rss.xml", homepage: "https://www.straitstimes.com/asia", region: "asia", home: "SG" },
  { id: "cna", name: "CNA", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511", homepage: "https://www.channelnewsasia.com/asia", region: "asia", home: "SG" },
  { id: "yonhap", name: "Yonhap", url: "https://en.yna.co.kr/RSS/news.xml", homepage: "https://en.yna.co.kr/", region: "asia", home: "KR" },
  { id: "vnexpress", name: "VnExpress International", url: "https://e.vnexpress.net/rss/news.rss", homepage: "https://e.vnexpress.net/", region: "asia", home: "VN" },
  { id: "irrawaddy", name: "The Irrawaddy", url: "https://www.irrawaddy.com/feed", homepage: "https://www.irrawaddy.com/", region: "asia", home: "MM" },
  // Middle East
  { id: "arabnews", name: "Arab News", url: "https://www.arabnews.com/rss.xml", homepage: "https://www.arabnews.com/", region: "middle-east", home: "SA" },
  { id: "almonitor", name: "Al-Monitor", url: "https://www.al-monitor.com/rss", homepage: "https://www.al-monitor.com/", region: "middle-east" },
  { id: "haaretz", name: "Haaretz", url: "https://www.haaretz.com/srv/haaretz-latest-headlines", homepage: "https://www.haaretz.com/", region: "middle-east", home: "IL" },
  { id: "thenational", name: "The National", url: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml", homepage: "https://www.thenationalnews.com/", region: "middle-east", home: "AE" },
  { id: "mee", name: "Middle East Eye", url: "https://www.middleeasteye.net/rss", homepage: "https://www.middleeasteye.net/", region: "middle-east" },
  // Africa
  { id: "africanews", name: "Africanews", url: "https://www.africanews.com/feed/rss", homepage: "https://www.africanews.com/", region: "africa" },
  { id: "allafrica", name: "AllAfrica", url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", homepage: "https://allafrica.com/", region: "africa" },
  { id: "premiumtimes", name: "Premium Times", url: "https://www.premiumtimesng.com/feed", homepage: "https://www.premiumtimesng.com/", region: "africa", home: "NG" },
  { id: "dailymaverick", name: "Daily Maverick", url: "https://www.dailymaverick.co.za/dmrss/", homepage: "https://www.dailymaverick.co.za/", region: "africa", home: "ZA" },
  { id: "africareport", name: "The Africa Report", url: "https://www.theafricareport.com/feed/", homepage: "https://www.theafricareport.com/", region: "africa" },
  // Latin America
  { id: "mercopress", name: "MercoPress", url: "https://en.mercopress.com/rss/", homepage: "https://en.mercopress.com/", region: "latin-america" },
  { id: "batimes", name: "Buenos Aires Times", url: "https://www.batimes.com.ar/feed", homepage: "https://www.batimes.com.ar/", region: "latin-america", home: "AR" },
  { id: "mexiconewsdaily", name: "Mexico News Daily", url: "https://mexiconewsdaily.com/feed/", homepage: "https://mexiconewsdaily.com/", region: "latin-america", home: "MX" },
  { id: "riotimes", name: "The Rio Times", url: "https://www.riotimesonline.com/feed/", homepage: "https://www.riotimesonline.com/", region: "latin-america" },
  { id: "colombiareports", name: "Colombia Reports", url: "https://colombiareports.com/feed/", homepage: "https://colombiareports.com/", region: "latin-america", home: "CO" },
  // Europe and the former Soviet space
  { id: "kyivindependent", name: "The Kyiv Independent", url: "https://kyivindependent.com/news-archive/rss/", homepage: "https://kyivindependent.com/", region: "europe", home: "UA" },
  { id: "meduza", name: "Meduza", url: "https://meduza.io/rss/en/all", homepage: "https://meduza.io/en", region: "europe", home: "RU" },
  { id: "balkaninsight", name: "Balkan Insight", url: "https://balkaninsight.com/feed/", homepage: "https://balkaninsight.com/", region: "europe" },
  { id: "euronews", name: "Euronews", url: "https://www.euronews.com/rss?level=theme&name=news", homepage: "https://www.euronews.com/", region: "europe" },
  { id: "rferl", name: "RFE/RL", url: "https://www.rferl.org/api/epiqq", homepage: "https://www.rferl.org/", region: "europe" },
  // Americas and Oceania
  { id: "cbc", name: "CBC News", url: "https://www.cbc.ca/webfeed/rss/rss-world", homepage: "https://www.cbc.ca/news/world", region: "americas" },
  { id: "rnz-pacific", name: "RNZ Pacific", url: "https://www.rnz.co.nz/rss/pacific.xml", homepage: "https://www.rnz.co.nz/international/pacific-news", region: "oceania" },
];
