# เซิร์ฟเวอร์ตัวกลาง (Claude proxy) สำหรับ AI Pill

ให้ผู้ใช้ทุกคนใช้ AI ได้ทันที **โดยไม่ต้องมี API Key ของตัวเอง**
คีย์ของคุณถูกเก็บเป็นความลับบน Cloudflare เท่านั้น ไม่อยู่ในเว็บ ไม่อยู่ใน GitHub และไม่ถูกส่งไปที่มือถือของผู้ใช้

```
มือถือผู้ใช้ ──► Cloudflare Worker (มีคีย์) ──► Claude API
```

## เซิร์ฟเวอร์นี้ป้องกันอะไรบ้าง

- รับคำขอจากเว็บของแอปเท่านั้น (`ALLOWED_ORIGINS`)
- รับเฉพาะคำขอแบบที่แอปส่ง: โมเดลที่กำหนด (`MODELS`), ข้อความและรูป, ไม่มี tools / ไม่ stream, effort ไม่เกิน medium, max_tokens ไม่เกิน 16000, ขนาดไม่เกิน 8 MB
- จำกัดจำนวนครั้งต่อวัน: ต่อเครื่อง (`DAILY_LIMIT_PER_DEVICE`, ค่าเริ่มต้น 20) และรวมทุกคน (`DAILY_LIMIT_TOTAL`, ค่าเริ่มต้น 100) นับใหม่ทุกวันเวลา 07:00 น. (เที่ยงคืน UTC) เมื่อครบ แอปจะบอกผู้ใช้ว่า "วันนี้ใช้ AI ครบจำนวนที่กำหนดแล้ว"
- ไม่เก็บรูปหรือข้อความของผู้ใช้ ตัวนับต่อเครื่องเก็บเป็นค่าแฮช ไม่ใช่รหัสเครื่องจริง

## ติดตั้งผ่านหน้าเว็บ Cloudflare (ไม่ต้องลงโปรแกรม)

1. สมัครหรือล็อกอินที่ **dash.cloudflare.com** (แพ็กเกจฟรีใช้ได้)
2. เมนู **Workers & Pages** → **Create** → **Create Worker** → ตั้งชื่อ `aipill-proxy` → **Deploy**
3. กด **Edit code** → ลบโค้ดตัวอย่างทั้งหมด → วางโค้ดทั้งไฟล์จาก [`worker.js`](worker.js) → **Deploy**
4. **สร้างที่เก็บตัวนับ:** เมนู **Storage & Databases** → **KV** → **Create** → ตั้งชื่อ `aipill-usage`
5. กลับไปที่ Worker `aipill-proxy` → **Settings** → **Bindings** → **Add** → **KV namespace**
   - Variable name: `USAGE`
   - KV namespace: `aipill-usage`
6. **Settings** → **Variables and Secrets** → **Add**:

   | ชื่อ | ชนิด | ค่า |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | **Secret** | คีย์ `sk-ant-…` จาก Claude Console |
   | `ALLOWED_ORIGINS` | Text | `https://app.medtrackq.com` |
   | `DAILY_LIMIT_PER_DEVICE` | Text | `20` (ไม่ใส่ก็ได้) |
   | `DAILY_LIMIT_TOTAL` | Text | `100` (ไม่ใส่ก็ได้) |

   แล้วกด **Deploy** อีกครั้ง
7. **ทดสอบ:** เปิดลิงก์ของ Worker เช่น `https://aipill-proxy.<ชื่อของคุณ>.workers.dev` ต้องเห็น `{"ok":true,"service":"aipill-proxy"}`
8. ส่งลิงก์นี้ให้ผู้พัฒนาใส่ใน `CONFIG.proxyUrl` ของ `js/app.js` (**ส่งแค่ลิงก์ ห้ามส่งคีย์**)

## ติดตั้งด้วยคำสั่ง (ทางเลือก)

ในโฟลเดอร์ `server/`:

```bash
npx wrangler kv namespace create USAGE
```

นำ id ที่ได้ไปใส่ใน `wrangler.toml` (เอาเครื่องหมาย `#` ออกจากบล็อก `[[kv_namespaces]]`) แล้ว:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

```bash
npx wrangler deploy
```

## ค่าใช้จ่ายและการตั้งเพดาน

- **Claude:** ถ่ายรูป 1 ครั้งประมาณ $0.03–0.06 (1–2 บาท) ถ้าตั้ง `DAILY_LIMIT_TOTAL = 100` ค่าใช้จ่ายสูงสุดประมาณ $3–6 ต่อวัน
  **ควรตั้งวงเงินต่อเดือนใน Claude Console (Limits) ด้วยเสมอ** เป็นเพดานสุดท้าย
- **Cloudflare (ฟรี):** Worker ได้ 100,000 ครั้ง/วัน แต่ KV เขียนได้ 1,000 ครั้ง/วัน และใช้ 2 ครั้งต่อคำขอ AI
  จึงตั้ง `DAILY_LIMIT_TOTAL` ได้ไม่เกินประมาณ 450 บนแพ็กเกจฟรี ถ้าต้องการมากกว่านี้ใช้ Workers Paid ($5/เดือน)

## ถ้าคีย์รั่วหรืออยากเปลี่ยนคีย์

1. Claude Console → API Keys → ปิดคีย์เดิม (Disable) แล้วสร้างคีย์ใหม่
2. Cloudflare → Worker → Settings → Variables and Secrets → แก้ `ANTHROPIC_API_KEY` เป็นคีย์ใหม่ → Deploy

ไม่ต้องแก้แอป

## ข้อควรรู้

- การตรวจเว็บต้นทาง (Origin) กันเว็บอื่นเรียกผ่านเบราว์เซอร์ได้ แต่สคริปต์ที่ปลอมหัวข้อได้ยังเรียกได้ ตัวจำกัดต่อวันและวงเงินใน Claude Console คือสิ่งที่จำกัดค่าใช้จ่ายจริง
- ตัวนับใน KV เป็นแบบประมาณ (อาจเกินจำนวนที่ตั้งไว้เล็กน้อยเมื่อมีคำขอพร้อมกันมาก)
- รูปซองยาโรงพยาบาลอาจมีชื่อผู้ป่วย รูปจะถูกส่งไปยัง Claude API เพื่อวิเคราะห์ ควรแจ้งผู้ใช้และขอความยินยอมตาม PDPA ก่อนเปิดใช้จริง
