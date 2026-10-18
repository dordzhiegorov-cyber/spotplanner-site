// Shared by the embed pages (place.html, ig.html) that the Spotplanner app shows in a web view.
// The page tells the app its height and whether it has anything to show; the app sizes the frame
// and hides it when the page is empty. Messages: { type: "spotplanner-embed", state, height? }.
(function () {
  function post(msg) {
    var m = JSON.stringify(Object.assign({ type: "spotplanner-embed" }, msg));
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m);
    else if (window.parent !== window) window.parent.postMessage(m, "*");
  }
  var last = 0;
  function report() {
    var h = Math.ceil(document.getElementById("root").getBoundingClientRect().height);
    if (h > 0 && Math.abs(h - last) > 1) {
      last = h;
      post({ state: "ready", height: h });
    }
  }
  window.spotplannerEmbed = {
    params: new URLSearchParams(location.search),
    empty: function (reason) {
      post({ state: "empty", reason: reason || "" });
    },
    // Call once content is on the page; keeps reporting while it settles (images, late layout).
    ready: function () {
      report();
      if (window.ResizeObserver) new ResizeObserver(report).observe(document.getElementById("root"));
      var n = 0;
      var id = setInterval(function () {
        report();
        if (++n > 20) clearInterval(id);
      }, 400);
    },
  };
})();
