/* Iconiq Hair & Beauty — site behaviour
   Everything here is progressive enhancement: pages stay readable without JS.
   NOTE: Forms and the booking wizard are front-end prototypes. On launch they
   are replaced by the real booking plugin (Amelia/Bookly) and a form handler. */

(function () {
  "use strict";

  /* ---------- Welcome splash ----------
     The <head> script adds .splash to <html> on the first page of a visit.
     Plays ~3.4s, then lifts away. Skip button, Esc, Enter or a click ends it early. */
  var root = document.documentElement;
  if (root.classList.contains("splash")) {
    try { sessionStorage.setItem("iconiq-splash", "1"); } catch (e) {}
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var splash = document.createElement("div");
    splash.className = "splash-screen";
    splash.setAttribute("role", "presentation");
    splash.innerHTML =
      '<div class="splash-inner">' +
        '<p class="splash-word" aria-label="Iconiq">' +
          "ICONIQ".split("").map(function (ch, i) {
            return '<span aria-hidden="true" style="--i:' + i + '">' + ch + "</span>";
          }).join("") +
        "</p>" +
        '<div class="splash-line" aria-hidden="true"></div>' +
        '<p class="splash-sub">Hair &amp; Beauty</p>' +
        '<p class="splash-tag">Luxury salon</p>' +
      "</div>" +
      '<button class="splash-skip" type="button">Skip intro</button>';

    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      clearTimeout(autoTimer);
      document.removeEventListener("keydown", onKey);
      root.classList.remove("splash");
      splash.classList.add("is-leaving");
      var remove = function () { if (splash.parentNode) splash.parentNode.removeChild(splash); };
      splash.addEventListener("transitionend", remove, { once: true });
      setTimeout(remove, 1200); // fallback when transitions are disabled
    };
    var onKey = function (e) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); }
    };
    splash.addEventListener("click", finish);
    document.addEventListener("keydown", onKey);

    document.body.appendChild(splash);
    var autoTimer = setTimeout(finish, reduced ? 1400 : 3400);
  }

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 961px)").addEventListener("change", function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  /* ---------- Footer year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- Helpers ---------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setError(input, message) {
    var errorEl = document.getElementById(input.id + "-error");
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (errorEl) errorEl.textContent = message || "";
  }

  function validateField(input) {
    var value = input.value.trim();
    var label = input.dataset.label || "This field";
    if (input.required && !value) return label + " is required.";
    if (value && input.type === "email" && !EMAIL_RE.test(value)) return "Please enter a valid email address.";
    if (value && input.type === "tel" && value.replace(/\D/g, "").length < 10) return "Please enter a 10-digit phone number.";
    return "";
  }

  function validateGroup(container) {
    var firstInvalid = null;
    container.querySelectorAll("input[required], select[required], textarea[required], input[type=email], input[type=tel]").forEach(function (input) {
      if (input.type === "radio" || input.type === "checkbox") return;
      var msg = validateField(input);
      setError(input, msg);
      if (msg && !firstInvalid) firstInvalid = input;
    });
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  /* ---------- Newsletter (footer) ---------- */
  document.querySelectorAll(".newsletter").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = form.querySelector("input[type=email]");
      var msg = form.parentElement.querySelector(".newsletter-msg");
      if (!EMAIL_RE.test(input.value.trim())) {
        msg.textContent = "Please enter a valid email address.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      input.setAttribute("aria-invalid", "false");
      msg.textContent = "Welcome to Iconiq Insider! Check your inbox for your welcome offer.";
      form.reset();
    });
  });

  /* ---------- Gallery filter ---------- */
  var filterBar = document.querySelector(".filter-bar");
  if (filterBar) {
    var items = document.querySelectorAll(".gallery-item");
    var countEl = document.getElementById("gallery-count");
    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-btn");
      if (!btn) return;
      var filter = btn.dataset.filter;
      filterBar.querySelectorAll(".filter-btn").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      var shown = 0;
      items.forEach(function (item) {
        var match = filter === "all" || item.dataset.category === filter;
        item.hidden = !match;
        if (match) shown++;
      });
      if (countEl) countEl.textContent = "Showing " + shown + " look" + (shown === 1 ? "" : "s");
    });
  }

  /* ---------- Hero slideshow ----------
     Auto-advances every 6s, pauses on hover/focus, has a pause button
     (WCAG 2.2.2) and never autoplays for prefers-reduced-motion users. */
  var slideshow = document.querySelector("[data-slideshow]");
  if (slideshow) {
    var slides = slideshow.querySelectorAll(".hero-slide");
    var hero = slideshow.closest(".hero");
    var dotsWrap = hero.querySelector(".hero-dots");
    var pauseBtn = hero.querySelector(".hero-pause");
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var active = 0;
    var timer = null;
    var userPaused = reduceMotion;
    var INTERVAL = 6000;

    var dots = Array.prototype.map.call(slides, function (slide, i) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "hero-dot";
      dot.setAttribute("aria-label", "Show slide " + (i + 1) + ": " + slide.querySelector("figcaption").textContent);
      dot.addEventListener("click", function () { goTo(i); restart(); });
      dotsWrap.appendChild(dot);
      return dot;
    });

    var goTo = function (index) {
      active = (index + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        var on = i === active;
        slide.classList.toggle("is-active", on);
        slide.setAttribute("aria-hidden", String(!on));
        dots[i].setAttribute("aria-current", String(on));
      });
    };

    var stop = function () { clearInterval(timer); timer = null; };
    var start = function () {
      if (userPaused || timer || slides.length < 2) return;
      timer = setInterval(function () { goTo(active + 1); }, INTERVAL);
    };
    var restart = function () { stop(); start(); };

    var setPaused = function (paused) {
      userPaused = paused;
      pauseBtn.setAttribute("aria-pressed", String(paused));
      pauseBtn.setAttribute("aria-label", paused ? "Play slideshow" : "Pause slideshow");
      if (paused) stop(); else start();
    };
    pauseBtn.addEventListener("click", function () { setPaused(!userPaused); });

    // Pause while the visitor is reading or using the hero, and when the tab is hidden.
    hero.addEventListener("mouseenter", stop);
    hero.addEventListener("mouseleave", start);
    hero.addEventListener("focusin", stop);
    hero.addEventListener("focusout", function (e) {
      if (!hero.contains(e.relatedTarget)) start();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });

    goTo(0);
    setPaused(userPaused);
  }

  /* ---------- Booking wizard ---------- */
  var wizard = document.getElementById("booking-wizard");
  if (!wizard) return;

  var steps = Array.prototype.slice.call(wizard.querySelectorAll(".booking-step"));
  var indicators = document.querySelectorAll(".steps li");
  var current = 0;
  var state = { service: null, stylist: null, date: null, time: null };

  var sum = {
    service: document.getElementById("sum-service"),
    stylist: document.getElementById("sum-stylist"),
    when: document.getElementById("sum-when"),
    price: document.getElementById("sum-price")
  };

  function formatDate(iso) {
    var parts = iso.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function updateSummary() {
    sum.service.textContent = state.service ? state.service.name : "—";
    sum.price.textContent = state.service ? state.service.price : "—";
    sum.stylist.textContent = state.stylist || "—";
    sum.when.textContent = state.date && state.time ? formatDate(state.date) + " at " + state.time : "—";
  }

  function showStep(index) {
    current = index;
    steps.forEach(function (step, i) { step.hidden = i !== index; });
    indicators.forEach(function (li, i) {
      li.classList.toggle("done", i < index);
      if (i === index) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    var heading = steps[index].querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    wizard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function stepError(index, message) {
    var el = steps[index].querySelector(".step-error");
    if (el) el.textContent = message || "";
  }

  // Service choice
  wizard.querySelectorAll("input[name=service]").forEach(function (input) {
    input.addEventListener("change", function () {
      state.service = { name: input.value, price: input.dataset.price };
      stepError(0, "");
      updateSummary();
    });
  });

  // Pre-select a service from ?service= (used by "Book this" links)
  var params = new URLSearchParams(window.location.search);
  var preset = params.get("service");
  if (preset) {
    var match = wizard.querySelector('input[name=service][data-slug="' + preset.replace(/[^a-z-]/g, "") + '"]');
    if (match) {
      match.checked = true;
      state.service = { name: match.value, price: match.dataset.price };
    }
  }

  // Stylist choice
  wizard.querySelectorAll("input[name=stylist]").forEach(function (input) {
    input.addEventListener("change", function () {
      state.stylist = input.value;
      stepError(1, "");
      updateSummary();
      renderTimes();
    });
  });

  // Date & time
  var dateInput = document.getElementById("book-date");
  var timeGrid = document.getElementById("time-grid");
  var today = new Date();
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var toIso = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90);
  dateInput.min = toIso(today);
  dateInput.max = toIso(maxDate);

  // Hours: Mon–Sat 9–7, Sun 10–4. Last start time leaves room for the service.
  function slotsFor(iso) {
    var p = iso.split("-");
    var day = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
    var open = day === 0 ? 10 : 9;
    var close = day === 0 ? 15 : 18;
    var slots = [];
    for (var h = open; h <= close; h++) {
      [0, 30].forEach(function (m) {
        if (h === close && m === 30) return;
        var hour12 = h > 12 ? h - 12 : h;
        slots.push(hour12 + ":" + pad(m) + (h >= 12 ? " PM" : " AM"));
      });
    }
    // Hide past times for today
    if (iso === toIso(today)) {
      var nowMinutes = today.getHours() * 60 + today.getMinutes() + 60;
      slots = slots.filter(function (s) {
        var t = s.match(/(\d+):(\d+) (AM|PM)/);
        var hh = (+t[1] % 12) + (t[3] === "PM" ? 12 : 0);
        return hh * 60 + +t[2] >= nowMinutes;
      });
    }
    return slots;
  }

  // Each time slot takes at most MAX_PER_SLOT bookings (enforced by server.py).
  var FULL_MESSAGE = "This time is fully booked. Please select another time.";
  var slotCounts = {};
  var slotMax = 2;
  var renderId = 0;

  function isFull(time) {
    return (slotCounts[time] || 0) >= slotMax;
  }

  function renderTimes() {
    state.time = null;
    updateSummary();
    timeGrid.innerHTML = "";
    if (!state.date) {
      timeGrid.innerHTML = '<p class="time-empty">Choose a date to see available times.</p>';
      return;
    }
    var day = state.date;
    var id = ++renderId;
    timeGrid.innerHTML = '<p class="time-empty">Checking available times…</p>';
    fetch("/api/slots?date=" + encodeURIComponent(day), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (data) {
        if (id !== renderId) return;
        slotCounts = data.counts || {};
        slotMax = data.max || 2;
        drawTimes(day);
      })
      .catch(function () {
        if (id !== renderId) return;
        timeGrid.innerHTML = '<p class="time-empty">We could not load available times. Please refresh the page or call us.</p>';
      });
  }

  function drawTimes(day) {
    timeGrid.innerHTML = "";
    var slots = slotsFor(day);
    if (!slots.length || slots.every(isFull)) {
      timeGrid.innerHTML = '<p class="time-empty">No openings left on this day — please try another date.</p>';
      return;
    }
    slots.forEach(function (slot, i) {
      var id = "time-" + i;
      var full = isFull(slot);
      var wrap = document.createElement("div");
      wrap.className = "choice" + (full ? " is-full" : "");
      wrap.innerHTML =
        '<input type="radio" name="time" id="' + id + '" value="' + slot + '">' +
        '<label class="choice-body" for="' + id + '">' + slot +
        (full ? '<span class="slot-full">Full</span>' : "") + "</label>";
      wrap.querySelector("input").addEventListener("change", function (e) {
        if (full) {
          e.target.checked = false;
          state.time = null;
          stepError(2, FULL_MESSAGE);
        } else {
          state.time = e.target.value;
          stepError(2, "");
        }
        updateSummary();
      });
      timeGrid.appendChild(wrap);
    });
  }

  dateInput.addEventListener("change", function () {
    state.date = dateInput.value || null;
    if (state.date && (state.date < dateInput.min || state.date > dateInput.max)) {
      state.date = null;
      stepError(2, "Please choose a date within the next 90 days.");
    }
    renderTimes();
  });

  // Navigation
  var validators = [
    function () { return state.service ? "" : "Please choose a service to continue."; },
    function () { return state.stylist ? "" : "Please choose a stylist (or “First available”)."; },
    function () {
      if (!state.date) return "Please choose a date.";
      if (!state.time) return "Please choose an available time.";
      if (isFull(state.time)) return FULL_MESSAGE;
      return "";
    }
  ];

  wizard.addEventListener("click", function (e) {
    var next = e.target.closest("[data-next]");
    var back = e.target.closest("[data-back]");
    if (next) {
      var msg = validators[current] ? validators[current]() : "";
      stepError(current, msg);
      if (msg) return;
      showStep(current + 1);
    } else if (back) {
      showStep(current - 1);
    }
  });

  wizard.addEventListener("submit", function (e) {
    e.preventDefault();
    var details = steps[3];
    var ok = validateGroup(details);
    var policy = document.getElementById("book-policy");
    var policyErr = document.getElementById("book-policy-error");
    if (!policy.checked) {
      policyErr.textContent = "Please confirm you have read the cancellation policy.";
      if (ok) policy.focus();
      ok = false;
    } else {
      policyErr.textContent = "";
    }
    if (!ok) return;

    var val = function (id) { return document.getElementById(id).value.trim(); };
    var submitBtn = wizard.querySelector("button[type=submit]");
    var submitErr = document.getElementById("book-policy-error");
    submitBtn.disabled = true;
    fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: state.service.name, stylist: state.stylist, date: state.date, time: state.time,
        first: val("book-first"), last: val("book-last"), email: val("book-email"),
        phone: val("book-phone"), notes: val("book-notes")
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; });
      })
      .then(function (res) {
        submitBtn.disabled = false;
        if (res.status === 409) {
          // Someone else took the last place: send the customer back to pick a new time.
          showStep(2);
          renderTimes();
          stepError(2, res.data.error || FULL_MESSAGE);
          return;
        }
        if (res.status !== 201) {
          submitErr.textContent = res.data.error || "Sorry, we couldn't save your booking. Please try again or call us.";
          return;
        }
        document.getElementById("confirm-name").textContent = val("book-first");
        document.getElementById("confirm-email").textContent = val("book-email");
        document.getElementById("confirm-detail").textContent =
          state.service.name + " with " + state.stylist + " on " + formatDate(state.date) + " at " + state.time + ".";
        document.querySelector(".steps").hidden = true;
        showStep(4);
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitErr.textContent = "Sorry, we couldn't save your booking. Please check your connection and try again.";
      });
  });

  updateSummary();
  renderTimes();
  // Always start the page at step 1 without stealing scroll position.
  steps.forEach(function (step, i) { step.hidden = i !== 0; });
})();
