"use strict";

// Renders a list of {name, description, icon, path, date} items as cards into
// #card-grid. Used by the top hub page (with CATEGORIES) and by each
// category page (with a filtered slice of APPS). `date` is optional — the
// top hub lists categories, which have no publication date of their own.
function renderCardGrid(items) {
  const grid = document.getElementById("card-grid");
  for (const item of items) {
    const card = document.createElement("a");
    card.className = "card";
    card.href = item.path;

    const icon = document.createElement("div");
    icon.className = "card-icon";
    icon.textContent = item.icon || "🔗";
    card.appendChild(icon);

    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = item.name;
    card.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = item.description || "";
    card.appendChild(desc);

    if (item.date) {
      const date = document.createElement("div");
      date.className = "card-date";
      date.textContent = item.date.replace(/-/g, ".");
      card.appendChild(date);
    }

    grid.appendChild(card);
  }
}
