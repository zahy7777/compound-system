import XCTest
@testable import Compound

final class NavigationPolicyTests: XCTestCase {
    func testAllowsOnlyCompoundDevPagesInsideApp() {
        XCTAssertEqual(
            NavigationPolicy.decide(URL(string: "https://songring.nat100.top/compound/dev/?presentation=mobile")!),
            .allowInsideApp
        )
        XCTAssertEqual(
            NavigationPolicy.decide(URL(string: "https://songring.nat100.top/compound/dev/access/session")!),
            .allowInsideApp
        )
    }

    func testSendsExternalHTTPSPagesToSafari() {
        XCTAssertEqual(
            NavigationPolicy.decide(URL(string: "https://developer.apple.com/")!),
            .openInSafari
        )
        XCTAssertEqual(
            NavigationPolicy.decide(URL(string: "https://songring.nat100.top/other")!),
            .openInSafari
        )
    }

    func testRejectsNonHTTPSURLs() {
        XCTAssertEqual(NavigationPolicy.decide(URL(string: "http://songring.nat100.top/compound/dev/")!), .cancel)
        XCTAssertEqual(NavigationPolicy.decide(URL(string: "custom-scheme://compound")!), .cancel)
    }
}
