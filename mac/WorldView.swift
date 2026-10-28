// WorldView for macOS — a native window around the local WorldView server.
// Starts the server if it's off (battery mode stops it), shows a splash until
// it answers, then loads the app in WebKit. External links open in the browser.
// Closing the window keeps a menu-bar ticker (quotes, watchlist, major events)
// and unloads the page, so the battery watcher can stop the server; the Dock
// badge counts new major events since you last looked.
// Built by scripts/build-mac-app.sh; the project folder is baked into Info.plist.
import Cocoa
import IOKit.ps
import WebKit

let serverURL = URL(string: "http://127.0.0.1:3000")!
let healthURL = URL(string: "http://127.0.0.1:3000/api/meta")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate, NSMenuDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var keepAlive: Timer?
    var statusItem: NSStatusItem!
    var statusTimer: Timer?
    var pendingJS: String?
    var lastPower: String?
    let projectDir = Bundle.main.object(forInfoDictionaryKey: "WVProjectDir") as? String ?? ""

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        log("launch")
        let config = WKWebViewConfiguration()
        // Page errors and console.error → .data/app.log (diagnostics).
        let hook = """
        (function(){var post=function(k,m){try{webkit.messageHandlers.wvlog.postMessage(k+': '+String(m).slice(0,2000))}catch(e){}};
        window.addEventListener('error',function(e){post('error',(e.message||'')+' @'+(e.filename||'')+':'+(e.lineno||''))});
        window.addEventListener('unhandledrejection',function(e){post('rejection',e.reason&&(e.reason.stack||e.reason.message)||e.reason)});
        var ce=console.error;console.error=function(){post('console.error',Array.prototype.join.call(arguments,' '));ce.apply(console,arguments)};
        document.addEventListener('DOMContentLoaded',function(){post('info','DOMContentLoaded '+location.href)});
        window.addEventListener('load',function(){var c=document.createElement('canvas');var gl=c.getContext('webgl2')||c.getContext('webgl');post('info','load; webgl='+(gl?'yes':'NO')+'; '+innerWidth+'x'+innerHeight)});})();
        """
        config.userContentController.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "wvlog")
        if FileManager.default.fileExists(atPath: "\(projectDir)/.data/app-debug") {
            // Debug: measure what keeps the page busy (map redraws, CSS animations, timers).
            let perf = """
            window.addEventListener('load',function(){setTimeout(function(){
              var post=function(m){webkit.messageHandlers.wvlog.postMessage('perf: '+m)};
              var anims={};document.getAnimations().forEach(function(a){var t=a.effect&&a.effect.target;var k=(a.animationName||'transition')+' | '+((t&&t.getAttribute&&t.getAttribute('class'))||'').slice(0,40);anims[k]=(anims[k]||0)+1});
              var cv=[].slice.call(document.querySelectorAll('canvas')).sort(function(a,b){return b.width*b.height-a.width*a.height})[0];
              var gl=cv&&(cv.getContext('webgl2')||cv.getContext('webgl'));var draws=0;
              if(gl){var o=gl.drawElements.bind(gl),o2=gl.drawArrays.bind(gl);gl.drawElements=function(){draws++;return o.apply(null,arguments)};gl.drawArrays=function(){draws++;return o2.apply(null,arguments)}}
              var frames=0,df=0,last=0,t0=performance.now();
              (function f(){frames++;if(draws!==last){df++;last=draws}if(performance.now()-t0<5000)requestAnimationFrame(f);else post(JSON.stringify({redrawsPerSec:df/5,drawCallsPerSec:Math.round(draws/5),canvas:cv&&(cv.width+'x'+cv.height),anims:anims,ui:localStorage.getItem('worldview-ui')}))})();
            },25000)});
            """
            config.userContentController.addUserScript(WKUserScript(source: perf, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsMagnification = true
        if #available(macOS 13.3, *) { web.isInspectable = true }
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1480, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "WorldView"
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(red: 0.04, green: 0.06, blue: 0.09, alpha: 1)
        window.minSize = NSSize(width: 900, height: 600)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName("WorldViewMain")
        if !window.setFrameUsingName("WorldViewMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        web.loadHTMLString(splash("Starting WorldView…"), baseURL: nil)
        markViewer()
        // While the window is open, tell the battery watcher someone is looking.
        keepAlive = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in self?.heartbeat() }
        DispatchQueue.global().async { self.startServerAndLoad() }
        setupStatusItem()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showMain()
        return true
    }

    func applicationWillTerminate(_ note: Notification) {
        // Let the battery watcher stop the server soon (it waits 10 min after the last viewer).
        let f = "\(projectDir)/.data/last-viewer"
        try? FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: f)
    }

    // MARK: diagnostics

    func log(_ msg: String) {
        guard !projectDir.isEmpty else { return }
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(msg)\n"
        let f = "\(projectDir)/.data/app.log"
        if let size = (try? FileManager.default.attributesOfItem(atPath: f))?[.size] as? Int, size > 512_000 { try? FileManager.default.removeItem(atPath: f) }
        if let h = FileHandle(forWritingAtPath: f) {
            h.seekToEndOfFile()
            h.write(line.data(using: .utf8)!)
            try? h.close()
        } else {
            try? line.write(toFile: f, atomically: true, encoding: .utf8)
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        log("page \(message.body)")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        log("loaded \(webView.url?.absoluteString ?? "-")")
        lastPower = nil
        pushPower()
        if webView.url?.scheme == "http", let js = pendingJS {
            pendingJS = nil
            // Give the page a moment to mount its stores before driving it.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { webView.evaluateJavaScript(js) }
        }
        // Debug: with .data/app-debug present, save what the window shows 10 s and 40 s after load.
        guard isLocal(webView.url), webView.url?.scheme == "http", FileManager.default.fileExists(atPath: "\(projectDir)/.data/app-debug") else { return }
        for delay in [10.0, 40.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.snapshot("app-snapshot-\(Int(delay))s.png") }
        }
    }

    func snapshot(_ name: String) {
        web.takeSnapshot(with: nil) { [weak self] img, _ in
            guard let self, let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return }
            try? png.write(to: URL(fileURLWithPath: "\(self.projectDir)/.data/\(name)"))
            self.log("snapshot \(name)")
        }
    }

    // MARK: server

    var recovering = false
    var misses = 0

    /** Every 20 s: keep the battery watcher from stopping the server, and if it went away anyway, bring it back. */
    func heartbeat() {
        guard window.isVisible else { return }
        markViewer()
        pushPower()
        guard !recovering, web.url?.scheme == "http" else { return }
        DispatchQueue.global().async {
            let up = self.serverUp()
            DispatchQueue.main.async {
                self.misses = up ? 0 : self.misses + 1
                // Two misses in a row (a busy server can be slow once): restart and reload.
                if self.misses >= 2 {
                    self.misses = 0
                    self.log("server stopped answering — restarting it")
                    self.retryLater()
                }
            }
        }
    }

    /// Tell the page whether the Mac is on battery, so it refreshes less often.
    func onBattery() -> Bool {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String? else { return false }
        return type == kIOPMBatteryPowerKey
    }

    func pushPower() {
        guard web.url?.scheme == "http" else { return }
        let p = onBattery() ? "battery" : "ac"
        if p == lastPower { return }
        lastPower = p
        web.evaluateJavaScript("window.__wvPower='\(p)';window.dispatchEvent(new Event('wv-power'))")
        log("power: \(p)")
    }

    func markViewer() {
        guard !projectDir.isEmpty else { return }
        let f = "\(projectDir)/.data/last-viewer"
        if !FileManager.default.fileExists(atPath: f) { FileManager.default.createFile(atPath: f, contents: nil) }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: f)
    }

    func serverUp() -> Bool {
        var req = URLRequest(url: healthURL)
        req.timeoutInterval = 5
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: req) { _, res, _ in
            ok = (res as? HTTPURLResponse)?.statusCode == 200
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 6)
        return ok
    }

    func startServerAndLoad() {
        log("server up? \(serverUp())")
        if !serverUp() {
            let plist = NSHomeDirectory() + "/Library/LaunchAgents/com.worldview.server.plist"
            if FileManager.default.fileExists(atPath: plist) {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                p.arguments = ["bootstrap", "gui/\(getuid())", plist]
                p.standardError = FileHandle.nullDevice
                p.standardOutput = FileHandle.nullDevice
                try? p.run()
                p.waitUntilExit()
            } else {
                DispatchQueue.main.async {
                    self.web.loadHTMLString(self.splash("WorldView's server isn't installed.<br><small>In the project folder run: npm run build &amp;&amp; npm run service:install</small>"), baseURL: nil)
                }
                return
            }
        }
        for _ in 0..<180 {
            if serverUp() {
                DispatchQueue.main.async { self.web.load(URLRequest(url: serverURL)) }
                return
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        DispatchQueue.main.async {
            self.web.loadHTMLString(self.splash("WorldView didn't start.<br><small>Check .data/server.log in the project folder, then press ⌘R.</small>"), baseURL: nil)
        }
    }

    func splash(_ message: String) -> String {
        """
        <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0f17;color:#cfd8e3;font:15px -apple-system,system-ui">
        <div style="text-align:center"><div style="width:56px;height:56px;margin:0 auto 18px;border-radius:50%;border:3px solid #3ee6d4;border-top-color:#ff8a2a;animation:s 1s linear infinite"></div>
        <div>\(message)</div></div><style>@keyframes s{to{transform:rotate(360deg)}}small{color:#7d8a99}</style></body></html>
        """
    }

    // MARK: navigation

    func isLocal(_ url: URL?) -> Bool {
        guard let u = url else { return true }
        if u.scheme == "about" || u.scheme == "data" || u.scheme == "blob" { return true }
        return u.host == "127.0.0.1" || u.host == "localhost"
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame != false, !isLocal(action.request.url), let u = action.request.url, ["http", "https", "mailto"].contains(u.scheme ?? "") {
            NSWorkspace.shared.open(u)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // target=_blank and window.open → default browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url {
            if isLocal(u) { webView.load(URLRequest(url: u)) } else { NSWorkspace.shared.open(u) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { log("navigation failed: \(error.localizedDescription)"); retryLater() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { log("load failed: \(error.localizedDescription)"); retryLater() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { log("web content process crashed — reloading"); webView.reload() }

    func retryLater() {
        guard !recovering else { return }
        recovering = true
        web.loadHTMLString(splash("Reconnecting to WorldView…"), baseURL: nil)
        DispatchQueue.global().async {
            self.startServerAndLoad()
            DispatchQueue.main.async { self.recovering = false }
        }
    }

    // MARK: menu

    @objc func reload() { web.load(URLRequest(url: serverURL)) }
    @objc func openInBrowser() { NSWorkspace.shared.open(web.url.flatMap { isLocal($0) ? $0 : nil } ?? serverURL) }
    @objc func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 2) }
    @objc func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.5) }
    @objc func zoomReset() { web.pageZoom = 1 }

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }
        let app = NSMenu()
        app.addItem(item("About WorldView", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""))
        app.addItem(.separator())
        app.addItem(item("Hide WorldView", #selector(NSApplication.hide(_:)), "h"))
        app.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        app.addItem(.separator())
        app.addItem(item("Quit WorldView", #selector(NSApplication.terminate(_:)), "q"))
        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", Selector(("undo:")), "z"))
        edit.addItem(item("Redo", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Cut", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Copy", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Paste", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Select All", #selector(NSText.selectAll(_:)), "a"))
        let view = NSMenu(title: "View")
        view.addItem(item("Reload", #selector(reload), "r", target: self))
        view.addItem(item("Open in Browser", #selector(openInBrowser), "o", [.command, .shift], target: self))
        view.addItem(.separator())
        view.addItem(item("Zoom In", #selector(zoomIn), "=", target: self))
        view.addItem(item("Zoom Out", #selector(zoomOut), "-", target: self))
        view.addItem(item("Actual Size", #selector(zoomReset), "0", target: self))
        view.addItem(.separator())
        view.addItem(item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        let go = NSMenu(title: "Go")
        for (i, (title, panel)) in [("World", "world"), ("News", "news"), ("Countries", "countries"), ("Markets", "markets"), ("Analyst", "analyst"), ("Briefing", "briefing"), ("Planet", "planet"), ("Energy", "energy"), ("Security", "security"), ("Trends", "trends"), ("Sources", "sources")].enumerated() {
            let it = item(title, #selector(goPanel(_:)), i < 9 ? "\(i + 1)" : "", target: self)
            it.representedObject = panel
            go.addItem(it)
        }
        go.addItem(.separator())
        go.addItem(item("Search…", #selector(goSearch), "k", target: self))
        let win = NSMenu(title: "Window")
        win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Close", #selector(NSWindow.performClose(_:)), "w"))
        for (title, sub) in [("WorldView", app), ("Edit", edit), ("View", view), ("Go", go), ("Window", win)] {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = sub
            main.addItem(top)
        }
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

// MARK: - main window, menu bar ticker, Dock badge

extension AppDelegate {
    func showMain() {
        NSApp.setActivationPolicy(.regular)
        if web.url?.scheme != "http" && !recovering {
            web.loadHTMLString(splash("Starting WorldView…"), baseURL: nil)
            DispatchQueue.global().async { self.startServerAndLoad() }
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        markViewer()
    }

    /// Closing the window parks the app in the menu bar: the page is unloaded
    /// (no GPU, no live connection) so on battery the server can stop.
    func windowWillClose(_ notification: Notification) {
        web.loadHTMLString(splash("WorldView is in the menu bar."), baseURL: nil)
        let f = "\(projectDir)/.data/last-viewer"
        try? FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: f)
        NSApp.setActivationPolicy(.accessory)
        log("window closed — menu bar only")
    }

    func windowDidBecomeKey(_ notification: Notification) {
        UserDefaults.standard.set(Date(), forKey: "majorSeenAt")
        NSApp.dockTile.badgeLabel = nil
    }

    /// Run JS in the page, loading the app first if it's parked.
    func drive(_ js: String) {
        if web.url?.scheme == "http" && !web.isLoading {
            web.evaluateJavaScript(js)
        } else {
            pendingJS = js
        }
        showMain()
    }

    func jsString(_ s: String) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)).flatMap { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    @objc func goPanel(_ sender: NSMenuItem) {
        guard let p = sender.representedObject as? String else { return }
        drive("window.worldview && window.worldview.openPanel(\(jsString(p)))")
    }
    @objc func goSearch() { drive("window.worldview && window.worldview.openPanel('search')") }
    @objc func openTickerItem(_ sender: NSMenuItem) {
        guard let s = sender.representedObject as? String else { return }
        drive("window.worldview && window.worldview.openTicker(\(jsString(s)))")
    }
    @objc func openEventItem(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        drive("window.worldview && window.worldview.openEvent(\(jsString(id)))")
    }
    @objc func openMain() { showMain() }
    @objc func quitApp() { NSApp.terminate(nil) }

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            b.image = NSImage(systemSymbolName: "globe.americas.fill", accessibilityDescription: "WorldView")
            b.image?.isTemplate = true
            b.imagePosition = .imageLeading
            b.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        }
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        renderStatus(nil, loading: true)
        refreshStatus()
        // Cheap: one small request a minute, only while the server is already running.
        statusTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refreshStatus() }
    }

    func menuWillOpen(_ menu: NSMenu) { refreshStatus() }

    func refreshStatus() {
        let since = (UserDefaults.standard.object(forKey: "majorSeenAt") as? Date) ?? Date()
        var comps = URLComponents(string: "http://127.0.0.1:3000/api/app/status")!
        comps.queryItems = [URLQueryItem(name: "since", value: ISO8601DateFormatter().string(from: since))]
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 8
        URLSession.shared.dataTask(with: req) { [weak self] data, res, _ in
            let ok = (res as? HTTPURLResponse)?.statusCode == 200
            let status = ok ? data.flatMap { try? JSONDecoder().decode(AppStatus.self, from: $0) } : nil
            DispatchQueue.main.async { self?.renderStatus(status) }
        }.resume()
    }

    func fmt(_ q: AppQuote) -> String {
        guard let p = q.price else { return "\(q.name) —" }
        let price = q.unit == "percent" ? String(format: "%.2f%%", p) : (p >= 1000 ? NumberFormatter.localizedString(from: NSNumber(value: Int(p.rounded())), number: .decimal) : String(format: "%.2f", p))
        guard let c = q.changePct else { return "\(q.name) \(price)" }
        return "\(q.name) \(price) \(c > 0 ? "▲" : c < 0 ? "▼" : "■")\(String(format: "%.2f", abs(c)))%"
    }

    func renderStatus(_ st: AppStatus?, loading: Bool = false) {
        guard let menu = statusItem?.menu, let button = statusItem.button else { return }
        menu.removeAllItems()
        func add(_ title: String, _ action: Selector? = nil, _ obj: Any? = nil, key: String = "") {
            let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
            it.target = self
            it.representedObject = obj
            if action == nil { it.isEnabled = false }
            menu.addItem(it)
        }
        if let st {
            let lead = st.quotes.first { $0.symbol == "^GSPC" }
            let n = st.newMajor
            button.title = (lead.map { " " + fmt($0).replacingOccurrences(of: "S&P 500", with: "S&P") } ?? "") + (n > 0 ? "  ⚠︎\(n)" : "")
            NSApp.dockTile.badgeLabel = n > 0 && !(window?.isKeyWindow ?? false) ? "\(n)" : nil
            add("Markets (delayed)")
            for q in st.quotes { add("   " + fmt(q), #selector(openTickerItem(_:)), q.symbol) }
            if !st.watchlist.isEmpty {
                menu.addItem(.separator())
                add("Watchlist")
                for q in st.watchlist { add("   " + fmt(q).replacingOccurrences(of: q.name, with: q.symbol), #selector(openTickerItem(_:)), q.symbol) }
            }
            menu.addItem(.separator())
            add(st.major.isEmpty ? "No major events in the last 6 hours" : "Major events (6h)")
            for e in st.major.prefix(6) {
                let t = e.title.count > 64 ? String(e.title.prefix(63)) + "…" : e.title
                add("   [\(e.importance)] \(t)", #selector(openEventItem(_:)), e.id)
            }
        } else {
            button.title = ""
            NSApp.dockTile.badgeLabel = nil
            if loading {
                add("Loading…")
            } else {
                add("WorldView is paused (battery saver)")
                add("Open it to resume live data")
            }
        }
        menu.addItem(.separator())
        add("Open WorldView", #selector(openMain), nil, key: "o")
        let panels = NSMenuItem(title: "Go to", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (title, panel) in [("World", "world"), ("News", "news"), ("Markets", "markets"), ("Analyst", "analyst"), ("Briefing", "briefing"), ("Planet", "planet"), ("Trends", "trends")] {
            let it = NSMenuItem(title: title, action: #selector(goPanel(_:)), keyEquivalent: "")
            it.target = self
            it.representedObject = panel
            sub.addItem(it)
        }
        panels.submenu = sub
        menu.addItem(panels)
        menu.addItem(.separator())
        add("Quit WorldView", #selector(quitApp), nil, key: "q")
        if FileManager.default.fileExists(atPath: "\(projectDir)/.data/app-debug") {
            log("menu bar: '\(button.title)' · badge \(NSApp.dockTile.badgeLabel ?? "-") · \(menu.items.map { $0.title.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " | "))")
        }
    }
}

struct AppQuote: Decodable { let symbol: String; let name: String; let price: Double?; let changePct: Double?; let unit: String? }
struct AppEvent: Decodable { let id: String; let title: String; let importance: Int }
struct AppStatus: Decodable { let quotes: [AppQuote]; let watchlist: [AppQuote]; let major: [AppEvent]; let newMajor: Int }

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
