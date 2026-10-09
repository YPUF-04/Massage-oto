# Massage-oto

Musterilere WhatsApp ve Telegram uzerinden otomatik, rastgele fotograf ve mesaj gonderen otomasyon. Gun icinde 3 zaman diliminde (sabah/ogle/aksam, saatler ve sayilari degistirilebilir) ayarladigin kadar musteriye, ayarladigin kadar fotografi rastgele ve tekrarsiz gonderir; her musteri mevcut arsivdeki tum fotograflari aldiginda arsiv otomatik olarak arsive tasinir ve yeni yuklemeye hazir hale gelir.

## Ozellikler

- **WhatsApp**: Baileys kutuphanesi ile kendi numarandan, ucretsiz (resmi API degil, QR ile baglanilir).
- **Telegram**: Resmi Bot API, tamamen ucretsiz ve ban riski yok.
- **3 zamanlama dilimi** (sabah/ogle/aksam): her biri icin ayri saat, musteri sayisi, musteri basina fotograf sayisi ve platform (WhatsApp/Telegram) secimi.
- **Tekrarsiz rastgele gonderim**: Bir musteriye once gonderilen fotograf tekrar gonderilmez.
- **Otomatik arsivleme**: Aktif havuzdaki tum fotograflar tum musterilere gonderildiginde, o havuz arsive tasinir (dosyalar `uploads/archive/batch-<id>/` icine), yeni fotograf yuklemen icin bos bir aktif havuz olusur.
- **Platform bazli mesaj sablonlari**: WhatsApp ve Telegram icin ayri ayri, rastgele secilen indirim/bilgi metinleri (fotografin altina caption olarak eklenir).
- **Ban riskini dusurme ayarlari**: gonderimler arasi rastgele gecikme, gunluk gonderim tavani, yeni WhatsApp numarasi icin "isinma modu" (ilk gunler daha az mesaj).
- **Admin paneli**: Sifre korumali web paneli; WhatsApp QR baglama, musteri yonetimi, fotograf yukleme, zamanlama ve mesaj sablonu ayarlari, gonderim gecmisi hepsi buradan.

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
3. Baglanti kurulunca durum "connected" olarak gorunur ve oturum `data/baileys_auth/` icinde saklanir (yeniden baslatmada tekrar QR okutmana gerek kalmaz).

## Musteri Ekleme

Panelin "Musteriler" sekmesinden isim, WhatsApp numarasi (ulke kodu ile, orn. `905551112233`) ve/veya Telegram baglama bilgisi ile ekleyebilirsin. Platform olarak WhatsApp, Telegram veya "her ikisi" secilebilir.

## Fotograf Yukleme ve Arsiv Mantigi

- "Fotograflar" sekmesinden istedigin kadar fotografi aktif havuza yukle (orn. 500 fotograf).
- Sistem her zamanlama caliştiginda, o slotun ayarlarina gore (kac musteri, musteri basina kac fotograf) rastgele ve o musteriye daha once gonderilmemis fotograflari secer ve gonderir.
- Bir musteri havuzdaki tum fotograflari aldiginda o musteri icin "tamamlandi" isaretlenir.
- **Tum aktif musteriler** havuzdaki tum fotograflari aldiginda, havuz otomatik olarak `uploads/archive/batch-<id>/` klasorune tasinir ve arsivlenmis olarak isaretlenir; yeni, bos bir aktif havuz olusur. Bu noktada yeni fotograflarini yukleyebilirsin.
- Panelin "Panel" sekmesinde aktif havuzun ilerlemesini (hangi musteriye kac fotograf gitti) canli olarak gorebilirsin.

## Zamanlama Ayarlari

"Zamanlama" sekmesinde sabah/ogle/aksam slotlari icin:
- Acik/kapali
- Saat (24 saat formati, `HH:MM`)
- Bu slotta kac musteriye gonderim yapilacagi
- Musteri basina kac fotograf gonderilecegi
- WhatsApp/Telegram'dan hangisinin aktif olacagi (orn. "bugun sadece Telegram'dan gonder" icin WhatsApp'i o slotta kapatabilirsin)
- Fotografla birlikte rastgele bir mesaj sablonu gonderilsin mi

Degisiklikler aninda etkili olur, sunucuyu yeniden baslatmana gerek yok. "Panel" sekmesinden istedigin slotu elle de "simdi calistir" ile tetikleyebilirsin.

## Mesaj Sablonlari

"Mesajlar" sekmesinde WhatsApp ve Telegram icin ayri ayri metin listeleri olusturabilirsin (orn. indirim duyurulari). Gonderim sirasinda bu listeden rastgele biri secilip son fotografin altina caption olarak eklenir. Her metni ayri ayri aktif/pasif yapabilir veya silebilirsin.

## Ayarlar

"Ayarlar" sekmesinde:
- Gonderimler arasi rastgele gecikme araligi (saniye)
- WhatsApp / Telegram gunluk gonderim tavani (0 = limitsiz)
- Isinma modu (yeni baglanan WhatsApp numarasi icin ilk N gun daha dusuk gunluk limit)
- Admin bildirim icin Telegram chat id'si (botuna `/myid` yazarak kendi chat id'ni ogrenebilirsin)

## Railway'e Deploy

1. Bu repoyu Railway'de yeni bir proje olarak baglat (GitHub repo'yu sec).
2. Railway projesine bir **Volume** ekle ve `/app/data` ile `/app/uploads` klasorlerine mount et (WhatsApp oturumu, veritabani ve fotograflarin kalici olmasi icin bu sart; volume olmadan her deploy'da hepsi silinir).
3. Environment Variables kismina `.env.example` dosyasindaki degiskenleri gercek degerlerle ekle (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `PORT` Railway tarafindan otomatik atanir).
4. Deploy sonrasi Railway'in verdigi domain uzerinden panele giris yap, WhatsApp QR'i okut, musterilerini ve ayarlarini gir.

## Mimari (kisaca)

```
src/
  db.js                  SQLite semasi ve varsayilan veriler
  server.js               Express sunucusu, giris noktasi
  auth/auth.js             Basit oturum tabanli admin girisi
  routes/api.js            Tum REST API uc noktalari
  services/
    settingsService.js    Ayarlar, slotlar, mesaj sablonlari
    customerService.js    Musteri CRUD
    photoService.js        Fotograf/arsiv yonetimi, rastgele secim
    campaignService.js     Gonderim motoru: secim, gonderim, limit/isinma, tamamlanma/arsivleme
  whatsapp/baileysClient.js  Baileys baglanti ve gonderim
  telegram/telegramClient.js Telegram Bot API (fetch ile, ekstra bagimlilik yok)
  scheduler/scheduler.js     Dakikada bir slot saatlerini kontrol eden zamanlayici
public/                    Admin paneli (vanilla HTML/CSS/JS)
```
