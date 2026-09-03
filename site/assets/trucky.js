/* Trucky -- de assistent rechtsonder.

   Los bestand, met opzet. De rest van app.js wordt door bouw/maakapp.py uit
   brok.js geknipt; dat script heeft een handgeschreven lijst van functienamen
   en zou dit stil terugdraaien. Hier staat alles bij elkaar en raakt niemand
   het aan.

   Praat met de edge function "trucky" in het dashboardproject. Daar zit de
   sleutel en daar staan de grenzen -- hier staat niets geheims en niets dat
   iemand hoeft te geloven.

   Het logo: hieronder staat een getekende vrachtwagen als tijdelijke mascotte.
   Is het echte plaatje er, zet het dan in assets/img/trucky.webp en vervang
   MASCOTTE door <img src="/assets/img/trucky.webp" alt="">.
*/
(function () {
  "use strict";

  var ADRES = "https://yxsbmhavnttswxczeovt.supabase.co/functions/v1/trucky";

  /* Eén gesprek per browser, zodat de teller op de server ergens op slaat.
     Bewust in sessionStorage: sluit je het tabblad, dan is het gesprek voorbij
     en begin je schoon. In localStorage zou een bezoeker van vorige maand nog
     tegen zijn oude limiet aanlopen. */
  var gesprekId = null;
  try {
    gesprekId = sessionStorage.getItem("trucky-gesprek");
    if (!gesprekId) {
      gesprekId = "g-" + Math.random().toString(36).slice(2) +
                  Math.random().toString(36).slice(2);
      sessionStorage.setItem("trucky-gesprek", gesprekId);
    }
  } catch (e) {
    /* Privémodus of cookies uit: dan een id dat alleen deze pagina meegaat. */
    gesprekId = "g-" + Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2);
  }

  var MASCOTTE =
    '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="16" width="19" height="12" rx="2" fill="#fff"/>' +
    '<path d="M22 19h7l5 5v4H22z" fill="#e23b2e"/>' +
    '<rect x="24" y="20.5" width="4.5" height="4" rx="1" fill="#bfe0ff"/>' +
    '<circle cx="10" cy="29.5" r="3.2" fill="#0a1220"/>' +
    '<circle cx="28" cy="29.5" r="3.2" fill="#0a1220"/>' +
    '<circle cx="10" cy="29.5" r="1.2" fill="#8a93a3"/>' +
    '<circle cx="28" cy="29.5" r="1.2" fill="#8a93a3"/>' +
    '<path d="M8 16V9h9v7z" fill="#e23b2e"/>' +
    '<circle cx="12.5" cy="7" r="3.4" fill="#f2c9a0"/>' +
    '<path d="M9 5.4a3.5 3.5 0 016.9 0z" fill="#0b1c42"/>' +
    "</svg>";

  var beurten = [];      // wat er gezegd is, voor de API en het verslag
  var bezig = false;
  var op = false;        // de limiet is bereikt
  var verslagGevraagd = false;

  /* ---------------- de schil ---------------- */

  var wortel = document.createElement("div");
  wortel.className = "trucky";
  wortel.innerHTML =
    '<div class="trucky-uitnodiging" hidden>' +
      '<button class="trucky-weg" aria-label="Sluiten">&times;</button>' +
      '<p><strong>Hoi, ik ben Trucky.</strong><br>' +
      "Zoek je een vestiging, een prijs of een vacature? Vraag maar raak.</p>" +
    "</div>" +
    '<button class="trucky-knop" aria-expanded="false" aria-label="Chat met Trucky openen">' +
      MASCOTTE +
    "</button>" +
    '<section class="trucky-venster" hidden aria-label="Chat met Trucky">' +
      '<header class="trucky-kop">' +
        '<span class="trucky-kop-icoon">' + MASCOTTE + "</span>" +
        "<span><strong>Trucky</strong><small>Assistent van Truckwash 1</small></span>" +
        '<button class="trucky-dicht" aria-label="Sluiten">&times;</button>' +
      "</header>" +
      '<div class="trucky-loop" role="log" aria-live="polite"></div>' +
      '<form class="trucky-invoer">' +
        '<label class="visueel-verborgen" for="trucky-veld">Je vraag</label>' +
        '<input id="trucky-veld" type="text" autocomplete="off" ' +
          'placeholder="Stel je vraag…" maxlength="1500">' +
        '<button type="submit" aria-label="Versturen">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l18-8L3 4l3 8z" fill="currentColor"/></svg>' +
        "</button>" +
      "</form>" +
      '<p class="trucky-klein">Trucky is een assistent. Voor zekerheid: ' +
        '<a href="tel:0880600100">088 - 0600 100</a>.</p>' +
    "</section>";
  document.body.appendChild(wortel);

  var knop = wortel.querySelector(".trucky-knop");
  var venster = wortel.querySelector(".trucky-venster");
  var loop = wortel.querySelector(".trucky-loop");
  var formulier = wortel.querySelector(".trucky-invoer");
  var veld = wortel.querySelector("#trucky-veld");
  var uitnodiging = wortel.querySelector(".trucky-uitnodiging");

  /* ---------------- berichten tonen ---------------- */

  function bij(wie, tekst, pagina) {
    var rij = document.createElement("div");
    rij.className = "trucky-bericht " + wie;

    var bel = document.createElement("div");
    bel.className = "trucky-bel";
    /* textContent en geen innerHTML. Wat hier binnenkomt is door een model
       geschreven op basis van wat een bezoeker intikte -- dat zet je nooit als
       HTML op je eigen pagina. */
    bel.textContent = tekst;
    rij.appendChild(bel);

    if (pagina) {
      var a = document.createElement("a");
      a.className = "trucky-pagina";
      a.href = pagina;
      a.textContent = "Bekijk de pagina";
      rij.appendChild(a);
    }

    loop.appendChild(rij);
    loop.scrollTop = loop.scrollHeight;
    return rij;
  }

  function denkt() {
    var rij = document.createElement("div");
    rij.className = "trucky-bericht trucky-van-hem trucky-denkt";
    rij.innerHTML = '<div class="trucky-bel"><i></i><i></i><i></i></div>';
    loop.appendChild(rij);
    loop.scrollTop = loop.scrollHeight;
    return rij;
  }

  /* ---------------- praten ---------------- */

  function vraag(tekst) {
    if (bezig || op) return;
    bezig = true;
    veld.value = "";
    bij("trucky-van-jou", tekst);
    beurten.push({ role: "user", content: tekst });
    var wacht = denkt();

    fetch(ADRES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gesprek: gesprekId,
        bericht: tekst,
        beurten: beurten.slice(0, -1),
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (a) {
        wacht.remove();
        if (!a || a.ok === false) {
          bij("trucky-van-hem", (a && a.reden) ||
            "Ik kan er even niet bij. Bel gerust 088 - 0600 100.");
          return;
        }
        bij("trucky-van-hem", a.antwoord, a.pagina);
        beurten.push({ role: "assistant", content: a.antwoord });
        if (a.contact) contactformulier();
        if (a.op) { op = true; sluitAf(); }
        else if (a.resterend === 2) {
          bij("trucky-van-hem", "We kunnen er nog een paar. Daarna verwijs ik " +
            "je door naar de telefoon.");
        }
      })
      .catch(function () {
        wacht.remove();
        bij("trucky-van-hem", "Ik krijg geen verbinding. Probeer het zo nog " +
          "eens, of bel 088 - 0600 100.");
      })
      .then(function () { bezig = false; veld.focus(); });
  }

  formulier.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = veld.value.trim();
    if (t) vraag(t);
  });

  /* ---------------- het contactformulier ----------------

     Komt tevoorschijn als Trucky iets niet mag of kan beantwoorden -- een
     vraag over een persoon, een klacht, een offerte. Dan gaat het naar een
     mens in plaats van dat er iets wordt verzonnen. */

  var formulierStaat = false;

  function contactformulier() {
    if (formulierStaat) return;
    formulierStaat = true;

    var blok = document.createElement("div");
    blok.className = "trucky-verslag trucky-contact";
    blok.innerHTML =
      "<p><strong>Laat je gegevens achter</strong><br>" +
      "Dan zoekt een collega het uit en neemt contact met je op.</p>" +
      "<form>" +
        '<input name="naam" type="text" placeholder="Je naam" autocomplete="name" required>' +
        '<input name="email" type="email" placeholder="E-mailadres" autocomplete="email" required>' +
        '<input name="telefoon" type="tel" placeholder="Telefoon (mag leeg)" autocomplete="tel">' +
        '<input name="bedrijf" type="text" placeholder="Bedrijf (mag leeg)" autocomplete="organization">' +
        '<textarea name="vraag" rows="3" placeholder="Waar gaat het over?" required></textarea>' +
        "<button type='submit'>Versturen</button>" +
      "</form>" +
      '<button class="trucky-nee" type="button">Liever niet</button>';
    loop.appendChild(blok);
    loop.scrollTop = loop.scrollHeight;

    /* De laatste vraag alvast invullen -- die heeft hij net getypt, en het
       twee keer moeten opschrijven is precies waar mensen op afhaken. */
    var laatste = null;
    for (var i = beurten.length - 1; i >= 0; i--) {
      if (beurten[i].role === "user") { laatste = beurten[i].content; break; }
    }
    if (laatste) blok.querySelector("[name=vraag]").value = laatste;

    blok.querySelector(".trucky-nee").addEventListener("click", function () {
      blok.remove();
      formulierStaat = false;
    });

    blok.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var kn = f.querySelector("button[type=submit]");
      kn.disabled = true;
      kn.textContent = "Versturen…";

      fetch(ADRES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gesprek: gesprekId,
          actie: "contact",
          naam: f.naam.value,
          email: f.email.value,
          telefoon: f.telefoon.value,
          bedrijf: f.bedrijf.value,
          vraag: f.vraag.value,
          beurten: beurten,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (a) {
          if (a && a.ok) {
            blok.innerHTML = "<p><strong>Verstuurd.</strong><br>Je krijgt een " +
              "bevestiging per mail, en een collega neemt contact met je op. " +
              "Heb je haast? Bel 088 - 0600 100.</p>";
          } else {
            kn.disabled = false;
            kn.textContent = "Versturen";
            var m = blok.querySelector(".trucky-fout") || document.createElement("p");
            m.className = "trucky-fout";
            m.textContent = (a && a.reden) || "Versturen lukte niet.";
            blok.appendChild(m);
          }
        })
        .catch(function () {
          kn.disabled = false;
          kn.textContent = "Versturen";
        });
    });
  }

  /* ---------------- het verslag ---------------- */

  function sluitAf() {
    if (verslagGevraagd || beurten.length < 2) return;
    verslagGevraagd = true;

    var blok = document.createElement("div");
    blok.className = "trucky-verslag";
    blok.innerHTML =
      "<p>Wil je dit gesprek per mail? Dan heb je het later terug.</p>" +
      '<form><label class="visueel-verborgen" for="trucky-mail">E-mailadres</label>' +
      '<input id="trucky-mail" type="email" placeholder="jij@bedrijf.nl" ' +
        'autocomplete="email" required>' +
      "<button type='submit'>Stuur maar</button></form>" +
      '<button class="trucky-nee" type="button">Nee, hoeft niet</button>';
    loop.appendChild(blok);
    loop.scrollTop = loop.scrollHeight;

    blok.querySelector(".trucky-nee").addEventListener("click", function () {
      blok.remove();
    });

    blok.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var adres = blok.querySelector("#trucky-mail").value.trim();
      if (!adres) return;
      var kn = blok.querySelector("button[type=submit]");
      kn.disabled = true;
      kn.textContent = "Versturen…";

      fetch(ADRES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gesprek: gesprekId, actie: "verslag", email: adres, beurten: beurten,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (a) {
          blok.innerHTML = a && a.ok
            ? "<p>Verstuurd naar " + adres.replace(/[<>&]/g, "") + ". " +
              "Staat hij er niet? Kijk even bij de ongewenste post.</p>"
            : "<p>" + ((a && a.reden) || "Versturen lukte niet.") + "</p>";
        })
        .catch(function () {
          blok.innerHTML = "<p>Versturen lukte niet. Probeer het later nog eens.</p>";
        });
    });
  }

  /* ---------------- openen en sluiten ---------------- */

  function open() {
    venster.hidden = false;
    knop.setAttribute("aria-expanded", "true");
    wortel.classList.add("trucky-open");
    uitnodiging.hidden = true;
    try { sessionStorage.setItem("trucky-uitnodiging", "gezien"); } catch (e) {}

    if (!loop.children.length) {
      bij("trucky-van-hem",
        "Hoi! Ik ben Trucky. Ik weet de weg op deze site: vestigingen, " +
        "openingstijden, prijzen en vacatures. Waarmee kan ik je helpen?");
    }
    setTimeout(function () { veld.focus(); }, 60);
  }

  function dicht() {
    /* Aan het eind van het gesprek vragen we naar het verslag -- maar pas als
       er ook echt iets te versturen valt. */
    if (beurten.length >= 2 && !verslagGevraagd) { sluitAf(); return; }
    venster.hidden = true;
    knop.setAttribute("aria-expanded", "false");
    wortel.classList.remove("trucky-open");
  }

  knop.addEventListener("click", function () {
    if (venster.hidden) open(); else dicht();
  });
  wortel.querySelector(".trucky-dicht").addEventListener("click", dicht);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !venster.hidden) dicht();
  });

  /* ---------------- de uitnodiging ---------------- */

  /* Niet meteen: wie net binnenkomt is aan het lezen, geen chatbot aan het
     zoeken. En één keer per tabblad -- een tekstballon die bij elke pagina
     opnieuw opduikt is een advertentie. */
  var alGezien = false;
  try { alGezien = sessionStorage.getItem("trucky-uitnodiging") === "gezien"; }
  catch (e) {}

  if (!alGezien) {
    setTimeout(function () {
      if (venster.hidden) {
        uitnodiging.hidden = false;
        wortel.classList.add("trucky-wenkt");
      }
    }, 6000);
  }

  wortel.querySelector(".trucky-weg").addEventListener("click", function (e) {
    e.stopPropagation();
    uitnodiging.hidden = true;
    wortel.classList.remove("trucky-wenkt");
    try { sessionStorage.setItem("trucky-uitnodiging", "gezien"); } catch (e2) {}
  });

  uitnodiging.addEventListener("click", open);
})();
