# Hapot-simulaatio

Lyhyt katsaus rakenteeseen ja miten kehittää.

## Rakennetta
 `lib/unifiedWater.js`: Yhdistetty vesimesh (sivut + pinta + meniskin logiikka). Korvaa aiemmat erilliset `water`, `meniscus`, `waterTop`, `meniscusUnder` meshit.
 `lib/ripples.js`: Legacy meniskin ripple-materiaalit (pidetty väliaikaisesti viitteiden vuoksi, voidaan poistaa kun diffuusio & kemia viittaukset päivitetty suoraan unifiediin).
 `lib/water.js`: Legacy vesimateriaalit (nyt piilotettu käytössä). 
## Ydinvirrat
 Shader/vesiefektit: uusi toteutus `lib/unifiedWater.js` (ripple + turbidity + indikaattori yhdessä shaderissa). Vanhat `water.js` ja `ripples.js` poistettavissa siirtymäkauden jälkeen.

## Toggle-uudistukset työkaluille
 Letku, sauva ja lusikka toimivat nyt toggle-periaatteella: sama klikkaus valitsee ja uudelleen klikkaus palauttaa alkuperäiseen lepopaikkaan.
 Lusikan palautus animoidaan aina 180° käännön kautta (varmistaa oikein päin-asennon).

## Unified water -muutokset
 Yksi BufferGeometry (sylinterin kuori + yläkansi) attribuutilla `aCapFlag` erottaa pinnan verteksit sivuista.
 Vertex-shader: ripple-siirtymä vain pinnalle ja reunan fade vähentää klippausta lasin sisällä.
 Fragment-shader: yhdistää indikaattorin paikallisen diffuusion, globaalin konsentraation, turbidityn (syvyys * konsentraatio), Fresnel-korosteen ja kevyen ambientin.
 Diffuusio (canvas blur) päivittää edelleen legacy uniformit; bridgen kautta synkronoimme arvot unified-water uniformeihin (`syncUnifiedChem`). Seuraava vaihe on kirjoittaa diffuusio suoraan unified-uniformeihin ja poistaa legacy.
 Legacy meshit on jätetty koodiin (mutta eivät enää lisäänny sceneen) regressiotestausta varten ja helpottamaan asteittaista poistamista.
## Kehitysvinkit
## Seuraavat siivousvaiheet
1. Poista diffuusion bindauksesta viittaukset meniscus/water -uniformeihin ja päivitä se syöttämään suoraan unifiediin.
2. Poista käyttämättömät mesh-instanssit ja materiaalit (vapauta GPU-muisti).
3. Siivoa `ripples.js` ja `water.js` kun varmistettu ettei muu koodi enää tuo niitä.
4. Poista debug-tint unified fragment shaderista.
- Uusia interaktioita lisätessä lisää handler `wireInteractions.js`:ään ja käytä `state`a.
- UI-muutokset valikoille: muokkaa `lib/uiMenus.js`.
- Shader/vesiefektit: katso `lib/water.js`, `lib/ripples.js` ja niiden uniforms-käyttö `index.html`-loopissa.

## Pika-ajot
Avaa `index.html` selaimessa tai käytä Live Serveriä VS Codessa. Preloader näyttää Aloita-painikkeen, joka käynnistää simulaation.

---

## Beakerin "kirkas soikio" (highlight) – mitä tehtiin

Alkuperäinen kirkas ellipsi syntyi pääosin:
1. Erittäin matala roughness + korkea transmission (melkein täydellinen linssi)
2. Suoraan suhteellisen matalasta kulmasta tuleva directional-light
3. Environment mapin spekulaarinen kontribuutio (envMapIntensity + Fresnel) kerrottuna kahdella heijastuspassilla (lasin paksuus)

Mitigaatiokerrokset (voi kytkeä/tweakata):
- Directional-valon nosto ja intensiteetin pienennys (`__lightDir(x,y,z)`, `__lightIntensity(val)`, preset: `__ellipsePreset()`).
- Mahdollinen sisäinen diffusoiva kuori (anti-hotspot) `__toggleBeakerInner()` – oletuksena pois päältä kirkkaamman lookin vuoksi.
- Shadow catcher + pienempi envMapIntensity lasille `enhanceShadows`-utilityn kautta.
- Caustic-plane (alla) joka rikkoo yhtenäisen kirkkaan alueen filamentteihin (visuaalinen hämäys realistisemman ilmeen aikaansaamiseksi).

## Procedural Caustic (kevyt ratkaisu)
Tiedosto: `lib/caustic.js`

Lisätty kevyt shader-pohjainen caustic-efekti beakerin alle. Tämä EI ole fyysisesti tarkka fotonisimulaatio, vaan kahden anisotrooppisen siniaaltoverkoston, koordinattiväännön ja radiaalisen pulssoinnin ("pulse") yhdistelmä joka muodostaa liikkuvia kirkkaampia filamentteja. Tavoite: hajota laaja tasainen bright-ellipse dynaamiseksi, jolloin katseen huomio jakautuu eikä hotspot näytä keinotekoiselta.

Blendaus: Additive (depthWrite=false) kerroksen renderöitynä aivan lattian yläpuolelle (y≈0.0025) jotta se "maalautuu" varjon päälle.

Uniformit (debuggaus konsolista globaalien helperien kautta):
- `uIntensity` – kokonaiskirkkaus (helper: `__causticIntensity(v)`)
- `uRadius` – pehmeän maskin säde (helper: `__causticRadius(v)`) – kannattaa pitää hieman beakerin jalan yli (1.0 → 1.2 * beakerRadius)
- `uColor` – lämmin sävy, muuta esim. `0xffffff` tai viileämmäksi `0xd8ecff` (helper: `__causticColor(0xffffff)`)
- `uScale1`, `uScale2` – perustaajudet; suurempi = tiheämpi filamenttikuvio
- `uSpeed1`, `uSpeed2` – animaation nopeudet (pienet muutokset vaikuttavat rytmiin)
- `uNoiseWarp` – satunnaisväännön määrä, lisää epäsäännöllisyyttä
- `uRippleMix` – radiaalisen pulssikomponentin painotus (0 → pois)

Kytkentä päälle/pois: `__toggleCaustic()`

Loop-integraatio: `beakerGroup.userData.updateCaustic(elapsed)` lisätty `index.html` loopin päivitystaulukkoon.

### Caustic-lähestymistavat (vertailu)
- Nykyinen: Halpa proseduuri (ei valon taittumista oikeasti). Hyöty: ~nollakustannus, ei tekstuureja, helppo säätää.
- Render-to-texture projektiokaustic: Renderöi veden topologian / normalit ortografiseen kameraan ja käytä sitä latenssilla lattiaan. Parempi yhteys oikeaan pinnan liikkeeseen, monimutkaisempi pipeline.
- Path tracing / photon mapping: Fyysisesti tarkka; liian raskas tähän selaintason simulaatioon ja useille laitteille.

## Veden pintarealismin lisäykset (unifiedWater)
Lisätyt uniformit (fragmentissa):
- `uSurfaceTint` & `uSurfaceTintStrength` – kevyt kylmä sävy pintakalvolle
- `uSurfaceFresnelBoost` – Fresnel-korosteen vahvistus vain kannelle
- `uSurfaceGloss`, `uSurfaceGlossPower` – pseudo-speculaarin koko ja terävyys
- `uEdgeVignette` – tummentaa aivan reuna-alueita luoden syvyysvaikutelman
- `uDepthSaturation` – syvyyskohtainen värin syveneminen (optinen paksuus)

Debug helperit (`window`):
- `__waterTint(hex, strength)`
- `__waterGloss(amp, power)`
- `__waterFresnel(boost)`
- `__waterEdge(vign, dark)`
- `__waterDepthSat(s)`

## Valon / varjojen debug helperit
- `__lightDir(x,y,z)` – siirrä directionalia
- `__lightIntensity(v)` – säädä intenstitettiä
- `__ellipsePreset()` – nopea preset ellipsin pienentämiseen
- `__shadowLevel(f)` – globaalinen varjojen kontrastiskala
- `__refreshShadows()` – pakota varjoflagit uudelleen
- `__boostShadows()` – testaa vahvempaa kontrastia

## Lasin parametrisointi
- `__beakerRoughness(r)`
- `__beakerIOR(v)`
- `__toggleBeakerInner()` – anti-hotspot kerroksen päälle/pois

## Caustic debug helperit
- `__toggleCaustic()`
- `__causticIntensity(v)`
- `__causticRadius(v)`
- `__causticColor(hex)`

## Suositellut kaustic-säädöt (lähtö)
```
__causticIntensity(0.65);
__causticRadius(1.05); // hiukan yli beakerin säteen
__causticColor(0xfff3d4); // lämmin laboratorion halogeeni
```
Jos haluat hillitymmän: laske intensiteetti 0.35–0.45 ja rippleMix pienemmäksi (muuta suoraan materiaalin uniformeista selaimen devtoolsissa).

## Jatkokehityksen ideat
1. Meniscus-geometrian ohut rengas (uniform meniscus ring) – todo id 17.
2. Projektiokaustic: Renderöi water-normal map erilliseen RTT:hen ja moduloi lattian valaistus sillä.
3. Pieni chromatic dispersion lasille (RGB ior offset) – hyvin kevyt offset shader modilla.
4. PBR-lähdevalokartta (rectAreaLight) simuloimaan valokaistaa pöydän yläpuolella.


