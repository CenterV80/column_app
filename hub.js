"use strict";

window.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("app-grid");
  for (const app of APPS) {
    const card = document.createElement("a");
    card.className = "app-card";
    card.href = app.path;

    const icon = document.createElement("div");
    icon.className = "app-card-icon";
    icon.textContent = app.icon || "🔗";
    card.appendChild(icon);

    const name = document.createElement("div");
    name.className = "app-card-name";
    name.textContent = app.name;
    card.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "app-card-desc";
    desc.textContent = app.description || "";
    card.appendChild(desc);

    grid.appendChild(card);
  }
});
