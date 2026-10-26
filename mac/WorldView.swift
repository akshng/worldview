// WorldView for macOS — a native window around the local WorldView server.
// Starts the server if it's off (battery mode stops it), shows a splash until
// it answers, then loads the app in WebKit. External links open in the browser.
// Built by scripts/build-mac-app.sh; the project folder is baked into Info.plist.
import Cocoa
import WebKit

let serverURL = URL(string: "http://127.0.0.1:3000")!
let healthURL = URL(string: "http://127.0.0.1:3000/api/meta")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var keepAlive: Timer?
    let projectDir = Bundle.main.object(forInfoDictionaryKey: "WVProjectDir") as? String ?? ""

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsMagnification = true
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
        window.setFrameAutosaveName("WorldViewMain")
        if !window.setFrameUsingName("WorldViewMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        web.loadHTMLString(splash("Starting WorldView…"), baseURL: nil)
        markViewer()
        // While the window is open, tell the battery watcher someone is looking.
        keepAlive = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.markViewer() }
        DispatchQueue.global().async { self.startServerAndLoad() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ note: Notification) {
        // Let the battery watcher stop the server soon (it waits 10 min after the last viewer).
        let f = "\(projectDir)/.data/last-viewer"
        try? FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: f)
    }

    // MARK: server

    func markViewer() {
        guard !projectDir.isEmpty else { return }
        let f = "\(projectDir)/.data/last-viewer"
        if !FileManager.default.fileExists(atPath: f) { FileManager.default.createFile(atPath: f, contents: nil) }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: f)
    }

    func serverUp() -> Bool {
        var req = URLRequest(url: healthURL)
        req.timeoutInterval = 1.5
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: req) { _, res, _ in
            ok = (res as? HTTPURLResponse)?.statusCode == 200
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 2)
        return ok
    }

    func startServerAndLoad() {
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

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retryLater() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retryLater() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func retryLater() {
        web.loadHTMLString(splash("Reconnecting to WorldView…"), baseURL: nil)
        DispatchQueue.global().async { self.startServerAndLoad() }
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
        let win = NSMenu(title: "Window")
        win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Close", #selector(NSWindow.performClose(_:)), "w"))
        for (title, sub) in [("WorldView", app), ("Edit", edit), ("View", view), ("Window", win)] {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = sub
            main.addItem(top)
        }
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
