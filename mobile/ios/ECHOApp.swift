import SwiftUI
import WebKit

@main
struct ECHOApp: App {
    var body: some Scene {
        WindowGroup { EchoScreen().ignoresSafeArea(edges: .bottom) }
    }
}

struct EchoScreen: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "echoNative")
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController = controller
        let view = WKWebView(frame: .zero, configuration: config)
        context.coordinator.webView = view
        view.navigationDelegate = context.coordinator
        view.scrollView.contentInsetAdjustmentBehavior = .never
        guard let directory = Bundle.main.url(forResource: "www", withExtension: nil) else {
            assertionFailure("Missing bundled www folder. Run mobile/package-web.ps1 and include www as folder reference.")
            return view
        }
        view.loadFileURL(directory.appendingPathComponent("index.html"), allowingReadAccessTo: directory)
        return view
    }
    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "echoNative",
                  message.frameInfo.isMainFrame,
                  let data = message.body as? [String: Any],
                  let id = data["id"] as? String,
                  id.count > 0, id.count < 41,
                  let type = data["type"] as? String else { return }
            if type == "cancel" { return }
            var response: [String: Any]
            switch type {
            case "status":
                response = ["platform": "ios", "ready": false, "languages": [String]()]
            default:
                response = ["error": "Мобильный AI-движок ещё не установлен. Используйте записи или голос устройства."]
            }
            guard let idData = try? JSONSerialization.data(withJSONObject: id, options: .fragmentsAllowed),
                  let replyData = try? JSONSerialization.data(withJSONObject: response),
                  let idJSON = String(data: idData, encoding: .utf8),
                  let replyJSON = String(data: replyData, encoding: .utf8) else { return }
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript(
                    "window.echoNativeReply && window.echoNativeReply(\(idJSON),\(replyJSON));"
                )
            }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, url.isFileURL else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
