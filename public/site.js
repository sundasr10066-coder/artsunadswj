(() => {
    const controls = document.createElement("aside");
    controls.className = "page-scroll-controls";
    controls.setAttribute("aria-label", "Page navigation");

    const topButton = document.createElement("button");
    topButton.type = "button";
    topButton.textContent = "↑ Top";
    topButton.setAttribute("aria-label", "Scroll to top of page");
    topButton.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const bottomButton = document.createElement("button");
    bottomButton.type = "button";
    bottomButton.textContent = "↓ End";
    bottomButton.setAttribute("aria-label", "Scroll to bottom of page");
    bottomButton.addEventListener("click", () => {
        window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth"
        });
    });

    controls.append(topButton, bottomButton);
    document.body.appendChild(controls);

    const currentPage = window.location.pathname.replace(/\/+$/, "") || "/";
    document.querySelectorAll(".site-nav a, .dashboard-nav a").forEach((link) => {
        const linkPath = new URL(link.href, window.location.origin).pathname
            .replace(/\/+$/, "") || "/";
        if (linkPath === currentPage) {
            link.classList.add("is-active");
            link.setAttribute("aria-current", "page");
        }
    });
})();
