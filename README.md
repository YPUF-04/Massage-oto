# Massage-oto

Musterilere WhatsApp ve Telegram uzerinden otomatik, rastgele fotograf ve mesaj gonderen otomasyon. Gun icinde 3 zaman diliminde (sabah/ogle/aksam, saatler ve sayilari degistirilebilir) ayarladigin kadar musteriye, ayarladigin kadar fotografi rastgele ve tekrarsiz gonderir; her musteri mevcut arsivdeki tum fotograflari aldiginda arsiv otomatik olarak arsive tasinir ve yeni yuklemeye hazir hale gelir.

## Ozellikler

- **WhatsApp**: Baileys kutuphanesi ile kendi numarandan, ucretsiz (resmi API degil, QR ile baglanilir).
- **Telegram**: Resmi Bot API, tamamen ucretsiz ve ban riski yok. Ayrica admin'e rapor/hata bildirimi gondermek icin de kullanilir.
- **3 zamanlama dilimi** (sabah/ogle/aksam): her biri icin ayri saat, musteri sayisi ve platform (WhatsApp/Telegram) secimi.
- **Adim sirasi (sequence)**: Her slot icin kendi sirani kurarsin - orn. "20 foto -> indirim mesaji -> 20 foto daha -> yeni koleksiyon mesaji". Foto ve mesaj bloklarini istedigin sirada, istedigin sayida ekleyip sirala; her secili musteri icin bu sira yukaridan asagiya calisir.
- **Toplu Mesaj**: Zamanlamadan bagimsiz, istedigin an secilen (veya tum) musterilere sadece metin mesaji gonderebilirsin (fotografsiz duyuru/hatirlatma icin).
- **Tekrarsiz rastgele gonderim**: Bir musteriye once gonderilen fotograf tekrar gonderilmez.
- **Otomatik arsivleme**: Aktif havuzdaki tum fotograflar tum musterilere gonderildiginde, o havuz arsive tasinir (dosyalar `storage/uploads/archive/batch-<id>/` icine), yeni fotograf yuklemen icin bos bir aktif havuz olusur.
- **Platform bazli mesaj sablonlari**: WhatsApp ve Telegram icin ayri ayri, rastgele secilen indirim/bilgi metinleri.
- **Onizleme (simulasyon)**: "Mesajlar" sekmesinde, gercek gonderim yapmadan WhatsApp ve Telegram baloncuk gorunumunde nasil gorunecegini gorursun.
- **Canli izleme**: Her calisma ikonlu, zaman damgali, ilerleme cubuklu olarak aninda panelde goruntulenir (kac musteri islendi, hangi adimda, kim hata aldi).
- **Admin Telegram bildirimleri**: Bir calisma hata verince ve her calisma bitince, admin'in Telegram'ina otomatik rapor gider (kac gonderim, kac hata, ne kadar surdu).
- **Ban riskini dusurme ayarlari**: gonderimler arasi rastgele gecikme, gunluk gonderim tavani, yeni WhatsApp numarasi icin "isinma modu" (ilk gunler daha az mesaj).
- **Admin paneli**: Sifre korumali web paneli; WhatsApp QR baglama, musteri yonetimi, fotograf yukleme, zamanlama/adim sirasi ve mesaj sablonu ayarlari, gonderim gecmisi hepsi buradan.

## Onemli: WhatsApp riski hakkinda

WhatsApp tarafi resmi olmayan bir kutuphane (Baileys) kullanir; bu, WhatsApp'in kullanim sartlarini ihlal eder ve numaranin kisitlanma/ban riski tasir. Riski dusurmek icin:
- **Ana is numarani degil, ayri bir numara kullan.**
- Musterilerin seni zaten rehberinde kayitli ve seninle onceden sohbet etmis olmasi riski onemli olcude dusurur (tanimadigin kisilere toplu mesaj atmak en riskli davranistir).
- Panelden gunluk gonderim tavanini ve "isinma modu"nu makul degerlerde tut (varsayilan: ilk 3 gun maksimum 10/gun).
- Telegram tarafinda bu risk yok, resmi ve ucretsiz.

## Kurulum (yerel test)

```bash
npm install
cp .env.example .env
# .env icindeki ADMIN_PASSWORD, SESSION_SECRET ve (istersen) TELEGRAM_BOT_TOKEN degerlerini doldur
npm start
```

Tarayicida `http://localhost:3000` adresini ac, `.env` icindeki ADMIN_USERNAME/ADMIN_PASSWORD ile giris yap.

## Telegram Bot Token Alma

1. Telegram'da [@BotFather](https://t.me/BotFather) ile konusma baslat.
2. `/newbot` yaz, bot icin bir isim ve kullanici adi belirle.
3. Sana verilen token'i `.env` dosyasindaki `TELEGRAM_BOT_TOKEN` degerine yapistir.
4. Musterilerin bu botu bulup `/start <baglama-kodu>` yazmasi gerekir. Baglama kodu, panelin "Musteriler" sekmesinde her musterinin yaninda gorunur (ornek: `/start a1b2c3d4`). Musteri bunu yazinca sistemi otomatik olarak o musterinin Telegram sohbet kimligini kaydeder.

## WhatsApp Baglama

1. Panelde "Panel" (Dashboard) sekmesinde "Baglan / QR goster" butonuna tikla.
2. Cikan QR kodu telefonundaki WhatsApp > Ayarlar > Baglı Cihazlar > Cihaz Baglama ile okut.
3. Baglanti kurulunca durum "connected" olarak gorunur ve oturum `storage/data/baileys_auth/` icinde saklanir (yeniden baslatmada tekrar QR okutmana gerek kalmaz).

## Musteri Ekleme

Panelin "Musteriler" sekmesinden isim, WhatsApp numarasi (ulke kodu ile, orn. `905551112233`) ve/veya Telegram baglama bilgisi ile ekleyebilirsin. Platform olarak WhatsApp, Telegram veya "her ikisi" secilebilir.

## Fotograf Yukleme ve Arsiv Mantigi

- "Fotograflar" sekmesinden istedigin kadar fotografi aktif havuza yukle (orn. 500 fotograf).
- Sistem her zamanlama caliştiginda, o slotun ayarlarina gore (kac musteri, musteri basina kac fotograf) rastgele ve o musteriye daha once gonderilmemis fotograflari secer ve gonderir.
- Bir musteri havuzdaki tum fotograflari aldiginda o musteri icin "tamamlandi" isaretlenir.
- **Tum aktif musteriler** havuzdaki tum fotograflari aldiginda, havuz otomatik olarak `storage/uploads/archive/batch-<id>/` klasorune tasinir ve arsivlenmis olarak isaretlenir; yeni, bos bir aktif havuz olusur. Bu noktada yeni fotograflarini yukleyebilirsin.
- Panelin "Panel" sekmesinde aktif havuzun ilerlemesini (hangi musteriye kac fotograf gitti) canli olarak gorebilirsin.

## Zamanlama Ayarlari

"Zamanlama" sekmesinde sabah/ogle/aksam slotlari icin:
- Acik/kapali
- Saat (24 saat formati, `HH:MM`)
- Bu slotta kac musteriye gonderim yapilacagi
- WhatsApp/Telegram'dan hangisinin aktif olacagi (orn. "bugun sadece Telegram'dan gonder" icin WhatsApp'i o slotta kapatabilirsin)

Her slotun altinda bir **adim sirasi (step)** editoru var. Burada "Fotograf Blogu" veya "Mesaj Blogu" ekleyip siralayabilirsin:
- **Fotograf Blogu**: kac fotograf gonderilecegini yazarsin (orn. 20).
- **Mesaj Blogu**: rastgele bir mesaj sablonundan mi secilecek, yoksa senin yazdigin sabit bir metin mi gonderilecek, onu secersin.

Ornek: "20 foto -> indirim mesaji -> 20 foto daha -> yeni koleksiyon mesaji" yapmak icin sirayla 4 adim eklersin: Fotograf(20) -> Mesaj(ozel: "Indirim var!") -> Fotograf(20) -> Mesaj(ozel: "Yeni koleksiyon!"). Bu sira, o slotta secilen HER musteri icin yukaridan asagiya calisir. Adimlari ok butonlariyla yukari/asagi tasiyabilir, "Sil" ile kaldirabilirsin.

Degisiklikler "Kaydet" butonuna basinca etkili olur, sunucuyu yeniden baslatmana gerek yok. "Panel" sekmesinden istedigin slotu elle de "simdi calistir" ile tetikleyebilirsin.

## Toplu Mesaj

"Toplu Mesaj" sekmesinden, zamanlamadan bagimsiz olarak istedigin an secilen musterilere (veya hicbirini secmezsen platforma uygun tum aktif musterilere) sadece metin mesaji gonderebilirsin. Fotograf gonderimiyle ayni gecikme ve gunluk limit ayarlarina uyar, "Panel" sekmesinde ayni canli gorunumle takip edilir.

## Mesaj Sablonlari

"Mesajlar" sekmesinde WhatsApp ve Telegram icin ayri ayri metin listeleri olusturabilirsin (orn. indirim duyurulari). Bu sablonlar, adim sirasinda "rastgele sablondan sec" secilen mesaj bloklarinda kullanilir. Her metni ayri ayri aktif/pasif yapabilir veya silebilirsin. Ayni sekmenin altinda, gercek gonderim yapmadan WhatsApp ve Telegram'da nasil gorunecegini gosteren bir **onizleme** bulunur.

## Ayarlar

"Ayarlar" sekmesinde:
- Gonderimler arasi rastgele gecikme araligi (saniye)
- WhatsApp / Telegram gunluk gonderim tavani (0 = limitsiz)
- Isinma modu (yeni baglanan WhatsApp numarasi icin ilk N gun daha dusuk gunluk limit)
- Admin bildirim icin Telegram chat id'si (botuna `/myid` yazarak kendi chat id'ni ogrenebilirsin)

## Railway'e Deploy: Senin Yapman Gerekenler

Kod hazir. Asagidaki adimlar **sadece sende** yapilabilir (hesabin, sifren, token'in icerir). Bunlar disinda hicbir sey yapman gerekmez.

```
[Sen]                                    [Railway]
  |                                          |
  | 1. GitHub ile giris yap ---------------> |
  | 2. "New Project" -> "Deploy from        |
  |    GitHub repo" -> Massage-oto sec ----> | proje olusur
  | 3. Settings -> Volumes -> "New Volume"  |
  |    Mount Path: /app/storage -----------> | kalici depo hazir
  | 4. Variables -> asagidaki 4 degeri gir ->| degerler kaydedilir
  | 5. Settings -> Networking ->             |
  |    "Generate Domain" ------------------> | adres olusur
  |                                          v
  |                                      otomatik deploy
  |                                          |
  | 6. Adrese gir, panelde giris yap,       |
  |    WhatsApp QR'i telefonla okut  <------ |
```

### 1. Adim: Railway'de proje ac
railway.app adresine gir, GitHub hesabinla giris yap. "New Project" -> "Deploy from GitHub repo" -> `Massage-oto` reposunu sec.

### 2. Adim: Kalici depo (Volume) ekle
Bu adim sart. Yoksa her deploy'da WhatsApp baglantisi ve fotograflar silinir.
- Projede Settings -> Volumes -> "New Volume"
- Mount Path alanina tam olarak sunu yaz: `/app/storage`
- Kaydet.

### 3. Adim: Degiskenleri (Variables) gir
Settings -> Variables kismina bu 4 degeri ekle:

| Isim | Deger |
|---|---|
| `ADMIN_USERNAME` | kendi sectigin bir kullanici adi (orn. `admin`) |
| `ADMIN_PASSWORD` | kendi sectigin guclu bir sifre |
| `SESSION_SECRET` | rastgele, uzun bir metin (orn. 30 karakter, klavyeden rastgele yaz) |
| `TELEGRAM_BOT_TOKEN` | BotFather'dan aldigin token (asagida anlatiliyor) |

`PORT` degiskenini Railway kendisi verir, sen eklemezsin.

### 4. Adim: Adres (domain) olustur
Settings -> Networking -> "Generate Domain". Sana bir adres verir (orn. `massage-oto.up.railway.app`).

### 5. Adim: Panele gir ve WhatsApp'i bagla
O adrese tarayicidan gir. 3. adimda yazdigin kullanici adi/sifre ile giris yap. "Panel" sekmesinde "Baglan / QR goster" butonuna tikla, cikan kodu telefonundaki WhatsApp > Baglı Cihazlar ile okut.

Bundan sonrasi (musteri ekleme, fotograf yukleme, zamanlama ayari) panelin icinden yapilir, baska bir kurulum gerekmez.

## Mimari (kisaca)

```
src/
  paths.js                 Kalici depo yollari (storage/data, storage/uploads)
  db.js                  SQLite semasi ve varsayilan veriler
  server.js               Express sunucusu, giris noktasi
  auth/auth.js             Basit oturum tabanli admin girisi
  routes/api.js            Tum REST API uc noktalari
  services/
    settingsService.js    Ayarlar, slotlar, mesaj sablonlari
    customerService.js    Musteri CRUD
    photoService.js        Fotograf/arsiv yonetimi, rastgele secim
    campaignService.js     Gonderim motoru: adim sirasi, secim, gonderim, limit/isinma, tamamlanma/arsivleme
    adminNotify.js          Admin'e Telegram uzerinden rapor/hata bildirimi
  whatsapp/baileysClient.js  Baileys baglanti ve gonderim
  telegram/telegramClient.js Telegram Bot API (fetch ile, ekstra bagimlilik yok)
  scheduler/scheduler.js     Dakikada bir slot saatlerini kontrol eden zamanlayici
public/                    Admin paneli (vanilla HTML/CSS/JS)
```
