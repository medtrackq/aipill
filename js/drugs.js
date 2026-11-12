/*
 * ฐานข้อมูลยาตัวอย่าง (Sample drug database)
 * ------------------------------------------------------------
 * ข้อมูลสรุปจากเอกสารกำกับยามาตรฐานของยาแต่ละชนิด เพื่อใช้เป็นต้นแบบ (prototype)
 * ก่อนใช้งานจริง ต้องให้เภสัชกรตรวจทาน และควรเชื่อมต่อกับฐานข้อมูลทางการ
 * เช่น ฐานข้อมูลผลิตภัณฑ์ของ อย. หรือฐานข้อมูลยาของโรงพยาบาล
 *
 * Summarised from standard product labelling. This is prototype content:
 * it must be reviewed by a pharmacist and connected to an official source
 * (Thai FDA product database or a hospital formulary) before production use.
 *
 * Field guide
 *   id           unique key used in URLs (#/drug/<id>)
 *   ingredient   active ingredient key, used to detect duplicate medicines
 *   generic      generic name per language
 *   brands       trade names and common aliases (any language, used for search)
 *   aliases      other names for THIS exact drug (nicknames, misspellings)
 *   allergyGroups  drug classes for allergy checks (see ALLERGY_GROUPS): an
 *                allergy to any member of a class is treated as an allergy
 *                to the whole class
 *   categories   broad words such as "ยาเบาหวาน" or "statin". They only list the
 *                drug as a candidate; they never open it directly or identify a
 *                scanned / AI-read name, because other drugs share the category.
 *   strength     usual strength shown in the database
 *   form         tablet | capsule
 *   looks        typical appearances, drawn as the reference picture on the
 *                drug page. Appearance differs by manufacturer.
 *   photo        optional URL of a real product photo (from an official source)
 *   highAlert    true for high-alert medicines (shown with a red banner)
 *   indications / usage / appearance            text per language
 *   cautions     orange: be careful (food, drowsiness, timing...)
 *   dangers      red: do not use / contraindications / dangerous misuse
 *   sideEffects  common side effects
 *   urgent       symptoms that need a doctor right away (red)
 *   dose         big-number summary of `usage` (see DOSES at the end)
 *   sources      reference labels shown to the user
 *   reviewed     date the entry was last reviewed (YYYY-MM)
 */
(function () {
  'use strict';

  // helper: one string in three languages
  const L = (th, en, zh) => ({ th, en, zh });

  const SRC_LABEL = L(
    'เอกสารกำกับยา (Package insert / SmPC) ของผลิตภัณฑ์',
    'Product package insert / SmPC',
    '药品说明书 (Package insert / SmPC)'
  );
  const SRC_FDA = L(
    'ตรวจสอบเลขทะเบียนตำรับยาได้ที่ สำนักงานคณะกรรมการอาหารและยา (อย.)',
    'Verify the registration number with the Thai Food and Drug Administration (Thai FDA)',
    '可在泰国食品药品监督管理局 (Thai FDA) 核实药品注册号'
  );

  const DRUGS = [
    {
      id: 'paracetamol',
      ingredient: 'paracetamol',
      generic: L('พาราเซตามอล', 'Paracetamol (Acetaminophen)', '对乙酰氨基酚（扑热息痛）'),
      brands: ['Sara', 'ซาร่า', 'Tylenol', 'ไทลินอล', 'Panadol', 'พานาดอล', 'Tempra', 'เทมปร้า'],
      aliases: ['para', 'พารา', 'acetaminophen', '扑热息痛', 'paracetamal', 'parasetamol'],
      categories: ['ยาแก้ปวด', 'ยาลดไข้'],
      strength: '500 mg',
      form: 'tablet',
      looks: [
        { shape: 'oblong', colors: ['white'], score: true },
        { shape: 'round', colors: ['white'], score: true }
      ],
      appearance: L(
        'มักเป็นเม็ดสีขาว ทรงกลมหรือทรงแคปซูลยาว มีขีดแบ่งครึ่งกลางเม็ด (แตกต่างตามผู้ผลิต)',
        'Usually a white round or oblong tablet with a score line (varies by manufacturer).',
        '通常为白色圆形或长椭圆形片剂，中间有刻痕（因厂家而异）。'
      ),
      indications: L(
        'บรรเทาอาการปวดระดับเล็กน้อยถึงปานกลาง เช่น ปวดศีรษะ ปวดกล้ามเนื้อ ปวดฟัน และลดไข้',
        'Relieves mild to moderate pain (headache, muscle ache, toothache) and reduces fever.',
        '缓解轻至中度疼痛（头痛、肌肉痛、牙痛）并退烧。'
      ),
      usage: L(
        'ผู้ใหญ่และเด็กอายุ 12 ปีขึ้นไป: ครั้งละ 1–2 เม็ด (500–1,000 มก.) ทุก 4–6 ชั่วโมงเมื่อมีอาการ ไม่เกินวันละ 8 เม็ด (4,000 มก.) — เด็กเล็กให้คำนวณตามน้ำหนักตัว ไม่ควรใช้ติดต่อกันเกิน 5 วัน',
        'Adults and children 12+: 1–2 tablets (500–1,000 mg) every 4–6 hours when needed. No more than 8 tablets (4,000 mg) in 24 hours. Young children: dose by body weight. Do not use for more than 5 days in a row.',
        '成人及12岁以上儿童：每次1–2片（500–1000毫克），需要时每4–6小时一次，24小时内不超过8片（4000毫克）。幼儿按体重计算剂量。连续使用不超过5天。'
      ),
      cautions: [
        L('หลีกเลี่ยงการดื่มแอลกอฮอล์ระหว่างใช้ยา', 'Avoid alcohol while taking this medicine.', '用药期间避免饮酒。'),
        L('ผู้ป่วยโรคตับ หรือผู้ที่ดื่มสุราเป็นประจำ ควรปรึกษาแพทย์ก่อนใช้', 'People with liver disease or who drink alcohol regularly should ask a doctor first.', '肝病患者或经常饮酒者应先咨询医生。'),
        L('ยาแก้หวัดหลายชนิดมีพาราเซตามอลผสมอยู่ ตรวจฉลากก่อนใช้ร่วมกัน', 'Many cold remedies already contain paracetamol – check labels before combining.', '许多感冒药已含有对乙酰氨基酚，合用前请检查标签。')
      ],
      dangers: [
        L('ห้ามใช้เกินขนาด อาจทำให้ตับถูกทำลายรุนแรงจนเสียชีวิตได้', 'Never exceed the maximum dose – overdose can cause severe, even fatal, liver damage.', '切勿超过最大剂量——过量可导致严重甚至致命的肝损伤。'),
        L('หากกินเกินขนาด ให้รีบโทร 1367 หรือไปโรงพยาบาลทันที แม้ยังไม่มีอาการ', 'If too much was taken, call 1367 or go to hospital immediately, even if there are no symptoms.', '如服用过量，即使没有症状也请立即拨打1367或前往医院。')
      ],
      sideEffects: [
        L('เมื่อใช้ในขนาดปกติ พบผลข้างเคียงน้อย', 'Side effects are uncommon at normal doses.', '正常剂量下副作用少见。'),
        L('ผื่นแพ้ (พบได้น้อย)', 'Skin rash or allergy (rare).', '皮疹或过敏（罕见）。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'ibuprofen',
      allergyGroups: ['nsaid'],
      ingredient: 'ibuprofen',
      group: 'nsaid',
      generic: L('ไอบูโพรเฟน', 'Ibuprofen', '布洛芬'),
      brands: ['Brufen', 'บรูเฟน', 'Nurofen', 'นูโรเฟน', 'Advil'],
      aliases: ['ibu', 'ไอบู', 'ibuprofin'],
      categories: ['ยาแก้ปวดกล้ามเนื้อ', 'ยาแก้อักเสบกล้ามเนื้อ', 'nsaid'],
      strength: '400 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['pink'] },
        { shape: 'oval', colors: ['pink'] },
        { shape: 'oblong', colors: ['white'] }
      ],
      appearance: L(
        'มักเป็นเม็ดเคลือบ สีชมพูหรือสีขาว ทรงกลมหรือทรงรี (แตกต่างตามผู้ผลิต)',
        'Usually a coated tablet, pink or white, round or oval (varies by manufacturer).',
        '通常为包衣片，粉色或白色，圆形或椭圆形（因厂家而异）。'
      ),
      indications: L(
        'ยาต้านการอักเสบชนิดไม่ใช่สเตียรอยด์ (NSAID) ใช้บรรเทาปวด ลดการอักเสบ ปวดข้อ ปวดกล้ามเนื้อ ปวดประจำเดือน และลดไข้',
        'An anti-inflammatory painkiller (NSAID) for pain, inflammation, joint and muscle pain, period pain and fever.',
        '非甾体抗炎药（NSAID），用于止痛、消炎、关节和肌肉疼痛、痛经及退烧。'
      ),
      usage: L(
        'ผู้ใหญ่: ครั้งละ 200–400 มก. ทุก 6–8 ชั่วโมง กินทันทีหลังอาหารพร้อมน้ำเต็มแก้ว ไม่เกินวันละ 1,200 มก. เว้นแต่แพทย์สั่ง',
        'Adults: 200–400 mg every 6–8 hours, straight after food with a full glass of water. No more than 1,200 mg a day unless a doctor advises.',
        '成人：每次200–400毫克，每6–8小时一次，饭后立即用一满杯水送服。除非医生建议，每日不超过1200毫克。'
      ),
      cautions: [
        L('ต้องกินหลังอาหารทันที เพื่อลดการระคายเคืองกระเพาะ', 'Take straight after food to protect the stomach.', '饭后立即服用以保护胃。'),
        L('ผู้สูงอายุมีความเสี่ยงเลือดออกในกระเพาะและไตเสื่อมสูงกว่าปกติ', 'Older adults have a higher risk of stomach bleeding and kidney problems.', '老年人胃出血和肾脏问题的风险更高。'),
        L('ผู้ป่วยความดันโลหิตสูง โรคหัวใจ หรือโรคไต ควรปรึกษาแพทย์ก่อนใช้', 'Ask a doctor first if you have high blood pressure, heart or kidney disease.', '如有高血压、心脏病或肾病，请先咨询医生。')
      ],
      dangers: [
        L('ห้ามใช้หากสงสัยว่าเป็นไข้เลือดออก (เพิ่มความเสี่ยงเลือดออก)', 'Do not use if dengue fever is suspected (raises bleeding risk).', '怀疑登革热时禁用（增加出血风险）。'),
        L('ห้ามใช้ในผู้ที่แพ้แอสไพรินหรือยากลุ่ม NSAIDs มีแผลในกระเพาะอาหาร หรือเลือดออกในทางเดินอาหาร', 'Do not use if allergic to aspirin/NSAIDs, or with a stomach ulcer or gut bleeding.', '对阿司匹林/NSAID过敏、有胃溃疡或消化道出血者禁用。'),
        L('ห้ามใช้ในหญิงตั้งครรภ์ไตรมาสสุดท้าย', 'Do not use in the last 3 months of pregnancy.', '妊娠晚期（最后3个月）禁用。')
      ],
      sideEffects: [
        L('ปวดท้อง แสบร้อนกลางอก คลื่นไส้', 'Stomach pain, heartburn, nausea.', '胃痛、烧心、恶心。'),
        L('เวียนศีรษะ', 'Dizziness.', '头晕。')
      ],
      urgent: [
        L('อุจจาระสีดำ หรืออาเจียนเป็นเลือด', 'Black stools or vomiting blood.', '黑便或呕血。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'aspirin-81',
      allergyGroups: ['nsaid'],
      ingredient: 'aspirin',
      group: 'antiplatelet',
      generic: L('แอสไพริน (ขนาดต่ำ)', 'Aspirin (low dose)', '阿司匹林（低剂量）'),
      brands: ['Aspent-M', 'แอสเพนท์', 'Bayer Aspirin', 'ไบเออร์'],
      aliases: ['aspirin', 'แอสไพริน', 'asa', 'asprin', 'แอสไพริน 81'],
      categories: ['ยาละลายลิ่มเลือด', 'ยาต้านเกล็ดเลือด'],
      strength: '81 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['white'] },
        { shape: 'round', colors: ['yellow'] }
      ],
      appearance: L(
        'มักเป็นเม็ดเล็ก ทรงกลม สีขาวหรือสีเหลือง บางชนิดเคลือบเพื่อไม่ให้แตกตัวในกระเพาะ',
        'Usually a small round white or yellow tablet; some are enteric-coated.',
        '通常为白色或黄色小圆片，部分为肠溶片。'
      ),
      indications: L(
        'ยาต้านเกล็ดเลือด ใช้ป้องกันลิ่มเลือดอุดตัน ลดความเสี่ยงโรคหัวใจขาดเลือดและหลอดเลือดสมอง ตามที่แพทย์สั่ง',
        'An antiplatelet medicine that prevents blood clots and lowers the risk of heart attack and stroke, when prescribed by a doctor.',
        '抗血小板药物，遵医嘱用于预防血栓，降低心脏病发作和中风风险。'
      ),
      usage: L(
        'ตามแพทย์สั่ง โดยทั่วไปวันละ 1 ครั้ง หลังอาหาร กลืนทั้งเม็ดหากเป็นชนิดเคลือบ ห้ามหยุดยาเองเพราะเสี่ยงเกิดลิ่มเลือด',
        'As prescribed – usually once a day after food. Swallow coated tablets whole. Do not stop on your own: stopping can trigger a clot.',
        '遵医嘱，通常每日一次，饭后服用。肠溶片须整片吞服。切勿自行停药，否则可能引发血栓。'
      ),
      cautions: [
        L('อาจมีเลือดออกง่าย ฟกช้ำง่าย', 'You may bleed or bruise more easily.', '可能更容易出血或瘀青。'),
        L('แจ้งแพทย์หรือทันตแพทย์ทุกครั้งก่อนผ่าตัดหรือถอนฟัน', 'Tell your doctor or dentist before any surgery or tooth extraction.', '手术或拔牙前务必告知医生或牙医。')
      ],
      dangers: [
        L('ห้ามใช้หากสงสัยว่าเป็นไข้เลือดออก', 'Do not use if dengue fever is suspected.', '怀疑登革热时禁用。'),
        L('ห้ามใช้ในผู้ที่แพ้แอสไพริน มีแผลในกระเพาะ หรือมีภาวะเลือดออกผิดปกติ', 'Do not use if allergic to aspirin, or with a stomach ulcer or a bleeding disorder.', '对阿司匹林过敏、有胃溃疡或出血性疾病者禁用。'),
        L('ห้ามใช้ในเด็กและวัยรุ่นอายุต่ำกว่า 16 ปีที่มีไข้จากไวรัส (เสี่ยงกลุ่มอาการเรย์)', 'Do not give to children under 16 with a viral illness (risk of Reye’s syndrome).', '16岁以下病毒感染的儿童禁用（有瑞氏综合征风险）。')
      ],
      sideEffects: [
        L('ระคายเคืองกระเพาะ แสบท้อง', 'Stomach upset, heartburn.', '胃部不适、烧心。'),
        L('ฟกช้ำง่าย เลือดกำเดาไหล', 'Easy bruising, nosebleeds.', '容易瘀青、流鼻血。')
      ],
      urgent: [
        L('อุจจาระสีดำ อาเจียนเป็นเลือด หรือเลือดออกไม่หยุด', 'Black stools, vomiting blood, or bleeding that will not stop.', '黑便、呕血或出血不止。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'warfarin',
      ingredient: 'warfarin',
      group: 'anticoagulant',
      highAlert: true,
      generic: L('วาร์ฟาริน', 'Warfarin', '华法林'),
      brands: ['Orfarin', 'ออร์ฟาริน', 'Coumadin', 'คูมาดิน'],
      aliases: ['warfarine', 'วาฟาริน'],
      categories: ['ยาต้านการแข็งตัวของเลือด', 'ยาละลายลิ่มเลือด'],
      strength: '1 / 2 / 3 / 5 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['white'], score: true },
        { shape: 'round', colors: ['blue'], score: true },
        { shape: 'round', colors: ['pink'], score: true },
        { shape: 'round', colors: ['orange'], score: true }
      ],
      appearance: L(
        'เม็ดกลม มีขีดแบ่ง สีของเม็ดยาแตกต่างกันตามความแรง — ต้องตรวจความแรง (มก.) บนฉลากทุกครั้ง',
        'Round scored tablet. The colour depends on the strength – always check the mg on the label.',
        '带刻痕的圆形片剂，颜色随规格不同——每次都要核对标签上的毫克数。'
      ),
      indications: L(
        'ยาต้านการแข็งตัวของเลือด ใช้ป้องกันและรักษาลิ่มเลือดอุดตัน เช่น ภาวะหัวใจเต้นผิดจังหวะ (AF) ลิ่มเลือดที่ขาหรือปอด หรือหลังเปลี่ยนลิ้นหัวใจ',
        'An anticoagulant that prevents and treats blood clots, e.g. in atrial fibrillation, leg or lung clots, or after heart valve replacement.',
        '抗凝药，用于预防和治疗血栓，例如房颤、腿部或肺部血栓，或心脏瓣膜置换术后。'
      ),
      usage: L(
        'กินตามขนาดที่แพทย์สั่งอย่างเคร่งครัด วันละ 1 ครั้งเวลาเดิมทุกวัน ขนาดยาปรับตามผลเลือด (INR) — ถ้าลืมกินให้กินทันทีที่นึกได้ภายในวันเดียวกัน ห้ามกินยาเพิ่มเป็น 2 เท่า',
        'Take exactly the dose your doctor prescribes, once a day at the same time. The dose is adjusted by blood tests (INR). If you miss a dose, take it the same day when you remember – never double the next dose.',
        '严格按医生处方剂量服用，每日一次，固定时间。剂量根据血液检查（INR）调整。如漏服，当天想起时立即补服——切勿下次加倍。'
      ),
      cautions: [
        L('กินผักใบเขียว (วิตามินเค) ในปริมาณสม่ำเสมอ ไม่เพิ่มหรือลดกะทันหัน', 'Keep the amount of leafy green vegetables (vitamin K) steady – do not suddenly eat much more or less.', '保持绿叶蔬菜（维生素K）摄入量稳定，不要突然大量增减。'),
        L('ก่อนใช้ยาใหม่ สมุนไพร หรืออาหารเสริม (เช่น แปะก๊วย กระเทียมสกัด น้ำมันปลา) ต้องปรึกษาแพทย์หรือเภสัชกร', 'Ask before starting any new medicine, herbal product or supplement (e.g. ginkgo, garlic extract, fish oil).', '开始服用任何新药、草药或保健品（如银杏、大蒜提取物、鱼油）前请先咨询。'),
        L('หลีกเลี่ยงแอลกอฮอล์ และแจ้งแพทย์/ทันตแพทย์ทุกครั้งว่าใช้ยานี้', 'Avoid alcohol and tell every doctor and dentist that you take warfarin.', '避免饮酒，并告知每位医生和牙医您在服用华法林。')
      ],
      dangers: [
        L('ยาความเสี่ยงสูง: ขนาดยาที่ผิดเพียงเล็กน้อยอาจทำให้เลือดออกรุนแรง', 'High-alert medicine: a small dose error can cause serious bleeding.', '高警示药物：剂量稍有差错即可导致严重出血。'),
        L('ห้ามกินร่วมกับแอสไพรินหรือยาแก้ปวดกลุ่ม NSAIDs (เช่น ไอบูโพรเฟน) เว้นแต่แพทย์สั่ง', 'Do not take with aspirin or NSAID painkillers (e.g. ibuprofen) unless your doctor says so.', '除非医生同意，不要与阿司匹林或NSAID止痛药（如布洛芬）同服。'),
        L('ห้ามใช้ในหญิงตั้งครรภ์ เว้นแต่แพทย์ผู้เชี่ยวชาญสั่ง', 'Not for use in pregnancy unless a specialist prescribes it.', '除非专科医生处方，孕妇禁用。')
      ],
      sideEffects: [
        L('ฟกช้ำง่าย เลือดออกตามไรฟัน เลือดกำเดาไหล', 'Easy bruising, bleeding gums, nosebleeds.', '容易瘀青、牙龈出血、流鼻血。')
      ],
      urgent: [
        L('อุจจาระสีดำ ปัสสาวะเป็นเลือด อาเจียนเป็นเลือด', 'Black stools, blood in urine, vomiting blood.', '黑便、血尿、呕血。'),
        L('ปวดศีรษะรุนแรงทันที หรือเลือดออกไม่หยุด', 'Sudden severe headache or bleeding that will not stop.', '突然剧烈头痛或出血不止。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'clopidogrel',
      ingredient: 'clopidogrel',
      group: 'antiplatelet',
      generic: L('โคลพิโดเกรล', 'Clopidogrel', '氯吡格雷'),
      brands: ['Plavix', 'พลาวิกซ์'],
      aliases: ['clopidogrel bisulfate', 'โคลพิโดเกรล 75', 'clopidogral'],
      categories: ['ยาต้านเกล็ดเลือด'],
      strength: '75 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['pink'] },
        { shape: 'oval', colors: ['pink'] }
      ],
      appearance: L(
        'มักเป็นเม็ดเคลือบสีชมพู ทรงกลมหรือทรงรี (แตกต่างตามผู้ผลิต)',
        'Usually a pink coated tablet, round or oval (varies by manufacturer).',
        '通常为粉色包衣片，圆形或椭圆形（因厂家而异）。'
      ),
      indications: L(
        'ยาต้านเกล็ดเลือด ป้องกันลิ่มเลือดในผู้ที่เคยเป็นโรคหัวใจขาดเลือด หลอดเลือดสมอง หรือหลังใส่ขดลวดถ่างขยายหลอดเลือด',
        'An antiplatelet medicine that prevents clots after a heart attack, stroke or a coronary stent.',
        '抗血小板药物，用于心脏病发作、中风或冠状动脉支架术后预防血栓。'
      ),
      usage: L(
        'ตามแพทย์สั่ง โดยทั่วไป 75 มก. วันละ 1 ครั้ง ห้ามหยุดยาเองโดยไม่ปรึกษาแพทย์โรคหัวใจ (เสี่ยงขดลวดอุดตัน)',
        'As prescribed – usually 75 mg once a day. Never stop without asking your heart doctor (risk of stent blockage).',
        '遵医嘱，通常每日一次，每次75毫克。未经心脏科医生同意切勿停药（有支架堵塞风险）。'
      ),
      cautions: [
        L('อาจมีเลือดออกง่าย แจ้งทันตแพทย์ก่อนทำฟัน', 'You may bleed more easily – tell your dentist before treatment.', '可能更容易出血——看牙前请告知牙医。'),
        L('ยาลดกรดโอเมพราโซลอาจลดประสิทธิภาพของยานี้ ปรึกษาแพทย์', 'Omeprazole (an acid reducer) can make this medicine work less well – ask your doctor.', '奥美拉唑（抑酸药）可能降低本药疗效——请咨询医生。')
      ],
      dangers: [
        L('ห้ามใช้ในผู้ที่มีเลือดออกอยู่ เช่น แผลในกระเพาะที่มีเลือดออก หรือเลือดออกในสมอง', 'Do not use with active bleeding, such as a bleeding stomach ulcer or bleeding in the brain.', '有活动性出血（如胃溃疡出血或脑出血）者禁用。')
      ],
      sideEffects: [
        L('ฟกช้ำ เลือดออกง่าย', 'Bruising, bleeding easily.', '瘀青、容易出血。'),
        L('ท้องเสีย ผื่น', 'Diarrhoea, rash.', '腹泻、皮疹。')
      ],
      urgent: [
        L('อุจจาระสีดำ อาเจียนเป็นเลือด หรือเลือดออกไม่หยุด', 'Black stools, vomiting blood, or bleeding that will not stop.', '黑便、呕血或出血不止。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'omeprazole',
      ingredient: 'omeprazole',
      group: 'ppi',
      generic: L('โอเมพราโซล', 'Omeprazole', '奥美拉唑'),
      brands: ['Miracid', 'มิราซิด', 'Losec', 'โลเสค'],
      aliases: ['omeprazol', 'โอเมพลาโซล'],
      categories: ['ยาลดกรด', 'ยาโรคกระเพาะ', 'ยากระเพาะ'],
      strength: '20 mg',
      form: 'capsule',
      looks: [
        { shape: 'capsule', colors: ['pink', 'red'] },
        { shape: 'capsule', colors: ['purple', 'white'] },
        { shape: 'capsule', colors: ['pink', 'brown'] }
      ],
      appearance: L(
        'แคปซูล สีแตกต่างตามผู้ผลิต (เช่น ชมพู ม่วง หรือสองสี)',
        'Capsule; colour varies by manufacturer (e.g. pink, purple or two-tone).',
        '胶囊，颜色因厂家而异（如粉色、紫色或双色）。'
      ),
      indications: L(
        'ลดการหลั่งกรดในกระเพาะอาหาร รักษาโรคกรดไหลย้อน แผลในกระเพาะอาหาร และอาการแสบร้อนกลางอก',
        'Reduces stomach acid; treats acid reflux (GERD), stomach ulcers and heartburn.',
        '减少胃酸分泌，治疗胃食管反流、胃溃疡和烧心。'
      ),
      usage: L(
        'โดยทั่วไป 20 มก. วันละ 1 ครั้ง ก่อนอาหารเช้า 30–60 นาที กลืนทั้งแคปซูล ห้ามเคี้ยว',
        'Usually 20 mg once a day, 30–60 minutes before breakfast. Swallow whole – do not chew.',
        '通常每日一次，每次20毫克，早餐前30–60分钟服用。整粒吞服，不要咀嚼。'
      ),
      cautions: [
        L('การใช้ต่อเนื่องเป็นเวลานานควรอยู่ในการดูแลของแพทย์', 'Long-term use should be supervised by a doctor.', '长期使用应在医生监督下进行。'),
        L('อาจลดประสิทธิภาพของยาโคลพิโดเกรล', 'May make clopidogrel work less well.', '可能降低氯吡格雷的疗效。')
      ],
      dangers: [
        L('หากกลืนลำบาก อาเจียนเป็นเลือด อุจจาระดำ หรือน้ำหนักลดโดยไม่ทราบสาเหตุ ต้องพบแพทย์ ไม่ควรรักษาเอง', 'Difficulty swallowing, vomiting blood, black stools or unexplained weight loss need a doctor – do not self-treat.', '如有吞咽困难、呕血、黑便或不明原因体重下降，必须就医，不要自行治疗。')
      ],
      sideEffects: [
        L('ปวดศีรษะ ท้องเสีย ปวดท้อง ท้องอืด', 'Headache, diarrhoea, stomach pain, bloating.', '头痛、腹泻、腹痛、腹胀。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'amoxicillin',
      allergyGroups: ['penicillin'],
      ingredient: 'amoxicillin',
      group: 'penicillin',
      generic: L('อะม็อกซีซิลลิน', 'Amoxicillin', '阿莫西林'),
      brands: ['Amoxil', 'อะม็อกซิล'],
      aliases: ['amoxy', 'อะม็อกซี่', 'amoxicilin', 'อะมอกซี'],
      categories: ['ยาแก้อักเสบ', 'ยาฆ่าเชื้อ', 'ยาปฏิชีวนะ', 'antibiotic'],
      strength: '500 mg',
      form: 'capsule',
      looks: [
        { shape: 'capsule', colors: ['red', 'yellow'] },
        { shape: 'capsule', colors: ['red', 'black'] },
        { shape: 'capsule', colors: ['pink', 'white'] }
      ],
      appearance: L(
        'แคปซูลสองสี สีแตกต่างตามผู้ผลิต',
        'Two-tone capsule; colours vary by manufacturer.',
        '双色胶囊，颜色因厂家而异。'
      ),
      indications: L(
        'ยาปฏิชีวนะ (ยาฆ่าเชื้อแบคทีเรีย) — ไม่ใช่ "ยาแก้อักเสบ" — ใช้รักษาการติดเชื้อแบคทีเรีย เช่น คออักเสบจากเชื้อแบคทีเรีย หูชั้นกลางอักเสบ ทางเดินหายใจ ทางเดินปัสสาวะ ไม่ได้ผลกับหวัดจากไวรัส',
        'An antibiotic (kills bacteria) – not an anti-inflammatory. Treats bacterial infections such as strep throat, ear, chest and urinary infections. It does not work for colds or flu (viruses).',
        '抗生素（杀灭细菌）——不是消炎药。用于细菌感染，如细菌性咽炎、中耳炎、呼吸道和尿路感染。对病毒引起的感冒或流感无效。'
      ),
      usage: L(
        'ตามแพทย์สั่ง โดยทั่วไป 500 มก. ทุก 8 ชั่วโมง กินก่อนหรือหลังอาหารก็ได้ ต้องกินจนหมดตามที่สั่ง แม้อาการดีขึ้นแล้ว',
        'As prescribed – usually 500 mg every 8 hours, with or without food. Finish the whole course even if you feel better.',
        '遵医嘱，通常每8小时500毫克，饭前饭后均可。即使症状好转也要服完整个疗程。'
      ),
      cautions: [
        L('อาจทำให้ท้องเสีย หากท้องเสียรุนแรงหรือถ่ายเป็นเลือดให้พบแพทย์', 'May cause diarrhoea – see a doctor if it is severe or bloody.', '可能引起腹泻——如严重或带血请就医。'),
        L('ห้ามแบ่งยาให้ผู้อื่น หรือเก็บไว้กินเองครั้งหน้า', 'Do not share it or save leftovers for next time.', '不要与他人分享或留着下次自己吃。')
      ],
      dangers: [
        L('ห้ามใช้ในผู้ที่แพ้ยากลุ่มเพนิซิลลิน', 'Do not use if you are allergic to penicillin.', '对青霉素过敏者禁用。')
      ],
      sideEffects: [
        L('ท้องเสีย คลื่นไส้', 'Diarrhoea, nausea.', '腹泻、恶心。'),
        L('ผื่นคัน', 'Itchy rash.', '瘙痒性皮疹。')
      ],
      urgent: [
        L('ผื่นลมพิษทั่วตัว ปากหรือตาบวม หายใจลำบาก (แพ้ยารุนแรง) — โทร 1669', 'Hives all over, swollen lips or eyes, trouble breathing (severe allergy) – call 1669.', '全身荨麻疹、嘴唇或眼睛肿胀、呼吸困难（严重过敏）——拨打1669。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'ciprofloxacin',
      allergyGroups: ['quinolone'],
      ingredient: 'ciprofloxacin',
      group: 'quinolone',
      generic: L('ไซโปรฟลอกซาซิน', 'Ciprofloxacin', '环丙沙星'),
      brands: ['Ciprobay', 'ซิโปรเบย์', 'Cipro'],
      aliases: ['cipro', 'ซิโปร', 'ไซโปร', 'ciprofloxacine'],
      categories: ['ยาฆ่าเชื้อ', 'ยาปฏิชีวนะ', 'antibiotic'],
      strength: '500 mg',
      form: 'tablet',
      looks: [
        { shape: 'oblong', colors: ['white'] },
        { shape: 'round', colors: ['white'] }
      ],
      appearance: L(
        'มักเป็นเม็ดเคลือบสีขาว ทรงแคปซูลยาวหรือทรงกลม (แตกต่างตามผู้ผลิต)',
        'Usually a white coated tablet, oblong or round (varies by manufacturer).',
        '通常为白色包衣片，长椭圆形或圆形（因厂家而异）。'
      ),
      indications: L(
        'ยาปฏิชีวนะ รักษาการติดเชื้อแบคทีเรีย เช่น ทางเดินปัสสาวะ และทางเดินอาหาร ตามที่แพทย์สั่ง',
        'An antibiotic for bacterial infections such as urinary and gut infections, when prescribed.',
        '抗生素，遵医嘱用于尿路和肠道等细菌感染。'
      ),
      usage: L(
        'ตามแพทย์สั่ง โดยทั่วไปทุก 12 ชั่วโมง ดื่มน้ำมาก ๆ และกินให้ครบตามที่สั่ง',
        'As prescribed – usually every 12 hours. Drink plenty of water and finish the course.',
        '遵医嘱，通常每12小时一次。多喝水，服完整个疗程。'
      ),
      cautions: [
        L('ห้ามกินพร้อมนม โยเกิร์ต หรือน้ำผลไม้เสริมแคลเซียมเพียงอย่างเดียว เพราะทำให้ยาดูดซึมได้น้อยลง', 'Do not take it with milk, yoghurt or calcium-fortified juice on their own – they stop the medicine being absorbed.', '不要单独与牛奶、酸奶或加钙果汁同服——会降低药物吸收。'),
        L('ยาลดกรด แคลเซียม ธาตุเหล็ก หรือสังกะสี: กินยานี้ก่อน 2 ชั่วโมง หรือหลัง 6 ชั่วโมง', 'Antacids, calcium, iron or zinc: take this medicine 2 hours before or 6 hours after them.', '抗酸药、钙、铁或锌：在其之前2小时或之后6小时服用本药。'),
        L('อาจทำให้ผิวไวต่อแสงแดด และเวียนศีรษะ', 'May make skin sensitive to sunlight and cause dizziness.', '可能使皮肤对阳光敏感并引起头晕。')
      ],
      dangers: [
        L('เสี่ยงเอ็นอักเสบหรือเอ็นฉีกขาด โดยเฉพาะผู้สูงอายุเกิน 60 ปี — หากปวดเอ็นหรือข้อเท้า ให้หยุดยาและพบแพทย์', 'Risk of tendon damage or rupture, especially over age 60 – stop and see a doctor if a tendon or ankle hurts.', '有肌腱炎或肌腱断裂风险，60岁以上尤甚——如肌腱或脚踝疼痛，请停药并就医。'),
        L('ห้ามใช้ในผู้ป่วยโรคกล้ามเนื้ออ่อนแรง (Myasthenia gravis)', 'Do not use with myasthenia gravis.', '重症肌无力患者禁用。')
      ],
      sideEffects: [
        L('คลื่นไส้ ท้องเสีย', 'Nausea, diarrhoea.', '恶心、腹泻。'),
        L('เวียนศีรษะ นอนไม่หลับ', 'Dizziness, trouble sleeping.', '头晕、失眠。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'chlorpheniramine',
      ingredient: 'chlorpheniramine',
      group: 'antihistamine',
      generic: L('คลอร์เฟนิรามีน', 'Chlorpheniramine (CPM)', '氯苯那敏（扑尔敏）'),
      brands: ['CPM', 'ซีพีเอ็ม', 'Piriton'],
      aliases: ['chlorphenamine', '扑尔敏', 'cpm 4'],
      categories: ['ยาแก้แพ้', 'ยาแก้แพ้เม็ดเหลือง', 'ยาแก้คัน'],
      strength: '4 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['yellow'], score: true },
        { shape: 'round', colors: ['white'] }
      ],
      appearance: L(
        'เม็ดเล็ก ทรงกลม มักเป็นสีเหลือง (บางผู้ผลิตเป็นสีขาว)',
        'Small round tablet, often yellow (white from some makers).',
        '小圆片，通常为黄色（部分厂家为白色）。'
      ),
      indications: L(
        'ยาแก้แพ้ บรรเทาอาการน้ำมูกไหล จาม คัน ผื่นลมพิษ',
        'An antihistamine for runny nose, sneezing, itching and hives.',
        '抗组胺药，缓解流鼻涕、打喷嚏、瘙痒和荨麻疹。'
      ),
      usage: L(
        'ผู้ใหญ่: ครั้งละ 1 เม็ด (4 มก.) ทุก 4–6 ชั่วโมงเมื่อมีอาการ ไม่เกินวันละ 6 เม็ด (24 มก.) — เด็กให้ปรึกษาเภสัชกร',
        'Adults: 1 tablet (4 mg) every 4–6 hours when needed, no more than 6 tablets (24 mg) a day. Children: ask a pharmacist.',
        '成人：需要时每4–6小时1片（4毫克），每日不超过6片（24毫克）。儿童请咨询药剂师。'
      ),
      cautions: [
        L('ทำให้ง่วงซึม ห้ามขับรถหรือทำงานกับเครื่องจักร', 'Causes drowsiness – do not drive or operate machinery.', '会引起嗜睡——不要驾车或操作机器。'),
        L('ห้ามดื่มแอลกอฮอล์ระหว่างใช้ยา', 'Do not drink alcohol while taking it.', '用药期间不要饮酒。'),
        L('ผู้สูงอายุเสี่ยงสับสน ปากแห้ง ปัสสาวะลำบาก และหกล้ม', 'Older adults are more likely to get confused, have a dry mouth, trouble passing urine, or fall.', '老年人更易出现意识混乱、口干、排尿困难或跌倒。')
      ],
      dangers: [
        L('ผู้ป่วยต้อหินชนิดมุมปิด หรือต่อมลูกหมากโตที่ปัสสาวะลำบาก ไม่ควรใช้', 'Avoid with narrow-angle glaucoma or an enlarged prostate with trouble passing urine.', '闭角型青光眼或前列腺肥大伴排尿困难者应避免使用。'),
        L('ห้ามใช้ในเด็กอายุต่ำกว่า 2 ปี', 'Do not give to children under 2.', '2岁以下儿童禁用。')
      ],
      sideEffects: [
        L('ง่วงนอน ปากแห้ง คอแห้ง', 'Drowsiness, dry mouth and throat.', '嗜睡、口干、咽干。'),
        L('ตาพร่า ท้องผูก', 'Blurred vision, constipation.', '视物模糊、便秘。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'metformin',
      ingredient: 'metformin',
      group: 'antidiabetic',
      generic: L('เมทฟอร์มิน', 'Metformin', '二甲双胍'),
      brands: ['Glucophage', 'กลูโคฟาจ'],
      aliases: ['metformin hcl', 'เมตฟอร์มิน', 'metformine'],
      categories: ['ยาเบาหวาน'],
      strength: '500 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['white'] },
        { shape: 'oblong', colors: ['white'] }
      ],
      appearance: L(
        'มักเป็นเม็ดเคลือบสีขาว ทรงกลมหรือทรงยาว (แตกต่างตามผู้ผลิต)',
        'Usually a white coated tablet, round or oblong (varies by manufacturer).',
        '通常为白色包衣片，圆形或长条形（因厂家而异）。'
      ),
      indications: L(
        'ยาลดระดับน้ำตาลในเลือด สำหรับโรคเบาหวานชนิดที่ 2',
        'Lowers blood sugar in type 2 diabetes.',
        '降低2型糖尿病患者的血糖。'
      ),
      usage: L(
        'ตามแพทย์สั่ง กินพร้อมอาหารหรือหลังอาหารทันที เพื่อลดอาการไม่สบายท้อง หากเป็นชนิดออกฤทธิ์นานให้กลืนทั้งเม็ด',
        'As prescribed, with or straight after meals to reduce stomach upset. Swallow extended-release tablets whole.',
        '遵医嘱，随餐或饭后立即服用以减少胃部不适。缓释片须整片吞服。'
      ),
      cautions: [
        L('ช่วงแรกอาจคลื่นไส้ ท้องเสีย มักดีขึ้นเอง', 'Nausea or diarrhoea at first usually settles.', '初期可能恶心或腹泻，通常会自行缓解。'),
        L('หลีกเลี่ยงการดื่มแอลกอฮอล์ปริมาณมาก', 'Avoid heavy drinking.', '避免大量饮酒。'),
        L('แจ้งแพทย์ก่อนผ่าตัดหรือฉีดสารทึบรังสี อาจต้องหยุดยาชั่วคราว', 'Tell your doctor before surgery or an X-ray dye scan – you may need to pause it.', '手术或注射造影剂前请告知医生——可能需要暂停用药。')
      ],
      dangers: [
        L('ห้ามใช้ในผู้ป่วยโรคไตรุนแรง', 'Do not use with severe kidney disease.', '严重肾病患者禁用。')
      ],
      sideEffects: [
        L('คลื่นไส้ ท้องเสีย รับรสโลหะ เบื่ออาหาร', 'Nausea, diarrhoea, metallic taste, poor appetite.', '恶心、腹泻、金属味、食欲不振。')
      ],
      urgent: [
        L('ปวดกล้ามเนื้อผิดปกติ หายใจหอบ อ่อนเพลียมาก ปวดท้อง (อาจเป็นภาวะกรดแลคติกคั่ง)', 'Unusual muscle pain, fast breathing, extreme tiredness, stomach pain (possible lactic acidosis).', '异常肌肉疼痛、呼吸急促、极度疲劳、腹痛（可能是乳酸酸中毒）。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'amlodipine',
      ingredient: 'amlodipine',
      group: 'ccb',
      generic: L('แอมโลดิพีน', 'Amlodipine', '氨氯地平'),
      brands: ['Norvasc', 'นอร์วาสก์'],
      aliases: ['amlodipine besylate', 'แอมโลดิปีน', 'amlodipin'],
      categories: ['ยาความดัน', 'ยาลดความดัน'],
      strength: '5 mg',
      form: 'tablet',
      looks: [
        { shape: 'round', colors: ['white'] },
        { shape: 'other', colors: ['white'] }
      ],
      appearance: L(
        'มักเป็นเม็ดสีขาว ทรงกลมหรือทรงแปดเหลี่ยม (แตกต่างตามผู้ผลิต)',
        'Usually a white round or octagonal tablet (varies by manufacturer).',
        '通常为白色圆形或八角形片剂（因厂家而异）。'
      ),
      indications: L(
        'ยาลดความดันโลหิต และรักษาอาการเจ็บหน้าอกจากหัวใจขาดเลือด',
        'Lowers blood pressure and treats angina (heart-related chest pain).',
        '降低血压，治疗心绞痛。'
      ),
      usage: L(
        'ตามแพทย์สั่ง โดยทั่วไปวันละ 1 ครั้ง เวลาเดิมทุกวัน ห้ามหยุดยาเองแม้ความดันปกติแล้ว',
        'As prescribed – usually once a day at the same time. Do not stop on your own, even when your blood pressure is normal.',
        '遵医嘱，通常每日一次，固定时间。即使血压正常也不要自行停药。'
      ),
      cautions: [
        L('ลุกจากท่านั่งหรือนอนช้า ๆ เพื่อป้องกันหน้ามืด', 'Get up slowly from sitting or lying to avoid feeling faint.', '从坐姿或卧姿缓慢起身，以免头晕。'),
        L('อาจทำให้ข้อเท้าบวม', 'May cause ankle swelling.', '可能引起脚踝肿胀。')
      ],
      dangers: [
        L('หากหน้ามืดเป็นลม หรือเจ็บหน้าอกมากขึ้น ให้พบแพทย์ทันที', 'Fainting or worsening chest pain needs a doctor right away.', '如晕厥或胸痛加重，请立即就医。')
      ],
      sideEffects: [
        L('ข้อเท้าบวม ปวดศีรษะ หน้าแดง ใจสั่น', 'Ankle swelling, headache, flushing, palpitations.', '脚踝肿胀、头痛、面部潮红、心悸。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    },

    {
      id: 'simvastatin',
      ingredient: 'simvastatin',
      group: 'statin',
      generic: L('ซิมวาสแตติน', 'Simvastatin', '辛伐他汀'),
      brands: ['Zocor', 'โซคอร์'],
      aliases: ['ซิมวา', 'simvastatine'],
      categories: ['ยาลดไขมัน', 'ยาลดคอเลสเตอรอล', 'statin'],
      strength: '20 mg',
      form: 'tablet',
      looks: [
        { shape: 'oval', colors: ['pink'] },
        { shape: 'round', colors: ['white'] },
        { shape: 'oval', colors: ['brown'] }
      ],
      appearance: L(
        'มักเป็นเม็ดเคลือบ ทรงรีหรือทรงกลม สีชมพู ขาว หรือน้ำตาลอ่อน (แตกต่างตามผู้ผลิต)',
        'Usually a coated oval or round tablet – pink, white or tan (varies by manufacturer).',
        '通常为椭圆或圆形包衣片，粉色、白色或浅棕色（因厂家而异）。'
      ),
      indications: L(
        'ยาลดไขมันคอเลสเตอรอล (LDL) ลดความเสี่ยงโรคหัวใจและหลอดเลือดสมอง',
        'Lowers LDL cholesterol and reduces the risk of heart attack and stroke.',
        '降低低密度脂蛋白胆固醇，降低心脏病和中风风险。'
      ),
      usage: L(
        'ตามแพทย์สั่ง วันละ 1 ครั้ง ตอนเย็นหรือก่อนนอน (ยาออกฤทธิ์ดีในช่วงกลางคืน)',
        'As prescribed – once a day in the evening or at bedtime (it works best at night).',
        '遵医嘱，每日一次，晚上或睡前服用（夜间效果最佳）。'
      ),
      cautions: [
        L('หลีกเลี่ยงการดื่มน้ำเกรปฟรุตปริมาณมาก', 'Avoid large amounts of grapefruit juice.', '避免大量饮用西柚汁。'),
        L('หากปวดเมื่อยกล้ามเนื้อผิดปกติ ให้แจ้งแพทย์', 'Tell your doctor about unexplained muscle aches.', '如有不明原因的肌肉酸痛，请告知医生。')
      ],
      dangers: [
        L('ห้ามใช้ในหญิงตั้งครรภ์และให้นมบุตร หรือผู้ป่วยโรคตับระยะรุนแรง', 'Do not use if pregnant, breastfeeding, or with active liver disease.', '孕妇、哺乳期妇女或活动性肝病患者禁用。')
      ],
      sideEffects: [
        L('ปวดกล้ามเนื้อ ท้องผูก ปวดศีรษะ', 'Muscle aches, constipation, headache.', '肌肉疼痛、便秘、头痛。')
      ],
      urgent: [
        L('ปวดกล้ามเนื้อรุนแรง อ่อนแรง ร่วมกับปัสสาวะสีเข้มคล้ายโคล่า', 'Severe muscle pain or weakness with dark, cola-coloured urine.', '严重肌肉疼痛或无力，伴可乐色深色尿液。')
      ],
      sources: [SRC_LABEL, SRC_FDA],
      reviewed: '2026-11'
    }
  ];

  /*
   * Drug–drug interactions between database entries.
   * level: 'major'    red    – avoid / dangerous unless a doctor manages it
   *        'moderate' orange – use with care, may need monitoring or timing
   * Pairs not listed are reported as "no interaction found in our database",
   * never as "safe".
   */
  const INTERACTIONS = [
    {
      pair: ['warfarin', 'aspirin-81'], level: 'major',
      text: L(
        'เพิ่มความเสี่ยงเลือดออกรุนแรงอย่างมาก ใช้ร่วมกันเฉพาะเมื่อแพทย์สั่งและติดตามอย่างใกล้ชิด',
        'Greatly increases the risk of serious bleeding. Use together only if a doctor prescribes both and monitors you closely.',
        '大大增加严重出血的风险。仅在医生同时处方并密切监测时才可合用。'
      )
    },
    {
      pair: ['warfarin', 'ibuprofen'], level: 'major',
      text: L(
        'เพิ่มความเสี่ยงเลือดออก โดยเฉพาะเลือดออกในกระเพาะอาหาร หลีกเลี่ยงการใช้ร่วมกัน — หากปวดให้ปรึกษาเภสัชกรเรื่องยาแก้ปวดที่เหมาะสม',
        'Raises the risk of bleeding, especially in the stomach. Avoid together – ask a pharmacist for a suitable painkiller.',
        '增加出血风险，尤其是胃出血。避免合用——请咨询药剂师选择合适的止痛药。'
      )
    },
    {
      pair: ['warfarin', 'clopidogrel'], level: 'major',
      text: L(
        'เพิ่มความเสี่ยงเลือดออกรุนแรง ใช้ร่วมกันเฉพาะเมื่อแพทย์สั่ง',
        'Raises the risk of serious bleeding. Use together only if a doctor prescribes both.',
        '增加严重出血风险。仅在医生同时处方时合用。'
      )
    },
    {
      pair: ['warfarin', 'ciprofloxacin'], level: 'major',
      text: L(
        'ไซโปรฟลอกซาซินทำให้ฤทธิ์ของวาร์ฟารินเพิ่มขึ้น (ค่า INR สูง) เสี่ยงเลือดออก แพทย์อาจต้องตรวจเลือดบ่อยขึ้นหรือปรับยา',
        'Ciprofloxacin boosts the effect of warfarin (higher INR) and raises bleeding risk. Your doctor may need to check your blood more often or adjust the dose.',
        '环丙沙星会增强华法林作用（INR升高），增加出血风险。医生可能需要更频繁地验血或调整剂量。'
      )
    },
    {
      pair: ['warfarin', 'paracetamol'], level: 'moderate',
      text: L(
        'การกินพาราเซตามอลเป็นครั้งคราวโดยทั่วไปใช้ได้ แต่ถ้ากินต่อเนื่องหลายวัน (มากกว่าวันละ 2,000 มก.) อาจทำให้ค่า INR สูงขึ้น ควรแจ้งแพทย์',
        'Occasional paracetamol is usually fine, but regular use for several days (over 2,000 mg a day) can raise INR – tell your doctor.',
        '偶尔服用对乙酰氨基酚通常没问题，但连续多日规律服用（每日超过2000毫克）可能使INR升高——请告知医生。'
      )
    },
    {
      pair: ['warfarin', 'amoxicillin'], level: 'moderate',
      text: L(
        'ยาปฏิชีวนะอาจทำให้ค่า INR เปลี่ยนแปลง แจ้งแพทย์ผู้ดูแลยาวาร์ฟารินเมื่อได้รับยาปฏิชีวนะ',
        'Antibiotics can change your INR – tell the doctor who manages your warfarin when you start one.',
        '抗生素可能改变INR——开始服用时请告知负责您华法林治疗的医生。'
      )
    },
    {
      pair: ['warfarin', 'simvastatin'], level: 'moderate',
      text: L(
        'อาจเพิ่มฤทธิ์ของวาร์ฟารินเล็กน้อย แพทย์อาจตรวจค่า INR เมื่อเริ่มหรือเปลี่ยนขนาดยา',
        'May slightly increase the effect of warfarin; your doctor may check INR when starting or changing the dose.',
        '可能轻度增强华法林作用；开始用药或调整剂量时医生可能会检查INR。'
      )
    },
    {
      pair: ['warfarin', 'omeprazole'], level: 'moderate',
      text: L(
        'โอเมพราโซลอาจเพิ่มฤทธิ์ของวาร์ฟารินเล็กน้อย ควรติดตามค่า INR',
        'Omeprazole may slightly increase the effect of warfarin; INR should be monitored.',
        '奥美拉唑可能轻度增强华法林作用，应监测INR。'
      )
    },
    {
      pair: ['clopidogrel', 'omeprazole'], level: 'major',
      text: L(
        'โอเมพราโซลลดประสิทธิภาพของโคลพิโดเกรลในการป้องกันลิ่มเลือด ไม่ควรใช้ร่วมกัน — อย่าหยุดยาเอง ให้ปรึกษาแพทย์เพื่อเปลี่ยนเป็นยาลดกรดชนิดอื่น',
        'Omeprazole weakens clopidogrel’s protection against clots, so they should not be combined. Do not stop either yourself – ask your doctor about a different acid reducer.',
        '奥美拉唑会削弱氯吡格雷的抗血栓作用，不应合用。不要自行停药——请咨询医生更换其他抑酸药。'
      )
    },
    {
      pair: ['aspirin-81', 'clopidogrel'], level: 'moderate',
      text: L(
        'แพทย์มักสั่งใช้ร่วมกันโดยตั้งใจ (เช่น หลังใส่ขดลวด) แต่เพิ่มความเสี่ยงเลือดออก ใช้ร่วมกันเฉพาะเมื่อแพทย์สั่งเท่านั้น',
        'Doctors often prescribe these together on purpose (e.g. after a stent), but bleeding risk is higher. Take both only if a doctor prescribed them.',
        '医生常有意联合处方（如支架术后），但出血风险更高。仅在医生处方时同时服用。'
      )
    },
    {
      pair: ['aspirin-81', 'ibuprofen'], level: 'moderate',
      text: L(
        'ไอบูโพรเฟนอาจลดฤทธิ์ป้องกันหัวใจของแอสไพรินขนาดต่ำ และเพิ่มความเสี่ยงเลือดออกในกระเพาะ ปรึกษาเภสัชกรเรื่องเวลาที่เหมาะสมหรือยาแก้ปวดตัวอื่น',
        'Ibuprofen can block the heart protection of low-dose aspirin and raises stomach-bleeding risk. Ask a pharmacist about timing or another painkiller.',
        '布洛芬可能削弱低剂量阿司匹林的心脏保护作用，并增加胃出血风险。请咨询药剂师服药时间或改用其他止痛药。'
      )
    },
    {
      pair: ['clopidogrel', 'ibuprofen'], level: 'moderate',
      text: L(
        'เพิ่มความเสี่ยงเลือดออก โดยเฉพาะในกระเพาะอาหาร หลีกเลี่ยงหากเป็นไปได้',
        'Raises bleeding risk, especially in the stomach. Avoid if possible.',
        '增加出血风险，尤其是胃出血。尽量避免合用。'
      )
    },
    {
      pair: ['simvastatin', 'amlodipine'], level: 'moderate',
      text: L(
        'แอมโลดิพีนเพิ่มระดับซิมวาสแตตินในเลือด เสี่ยงปวดกล้ามเนื้อ — ขนาดซิมวาสแตตินไม่ควรเกินวันละ 20 มก. เมื่อใช้ร่วมกัน',
        'Amlodipine raises simvastatin levels and the risk of muscle problems – simvastatin should not exceed 20 mg a day when combined.',
        '氨氯地平会升高辛伐他汀血药浓度，增加肌肉问题风险——合用时辛伐他汀每日不应超过20毫克。'
      )
    },
    {
      pair: ['ciprofloxacin', 'metformin'], level: 'moderate',
      text: L(
        'อาจทำให้ระดับน้ำตาลในเลือดสูงหรือต่ำผิดปกติ ควรตรวจน้ำตาลบ่อยขึ้นระหว่างใช้ยาปฏิชีวนะ',
        'May make blood sugar go unusually high or low – check your sugar more often during the antibiotic course.',
        '可能导致血糖异常升高或降低——服用抗生素期间应更频繁地监测血糖。'
      )
    },
    {
      pair: ['ibuprofen', 'amlodipine'], level: 'moderate',
      text: L(
        'ยากลุ่ม NSAIDs อาจลดฤทธิ์ลดความดันโลหิต หากต้องใช้ต่อเนื่องควรวัดความดันและปรึกษาแพทย์',
        'NSAIDs can weaken blood-pressure control. If you need them regularly, check your blood pressure and ask your doctor.',
        'NSAID类药物可能削弱降压效果。如需长期使用，请监测血压并咨询医生。'
      )
    }
  ];

  /*
   * Drug classes used for allergy checks. `terms` are names of members (in
   * any language) so free-text allergies such as "Augmentin" or "ซัลฟา" map
   * to a class. `cross` lists classes with a known, lower cross-allergy risk
   * (shown in orange, not red).
   */
  const ALLERGY_GROUPS = [
    {
      id: 'penicillin',
      name: L('ยากลุ่มเพนิซิลลิน', 'Penicillins', '青霉素类'),
      terms: ['penicillin', 'penicillins', 'เพนิซิลลิน', 'เพนนิซิลลิน', 'amoxicillin', 'ampicillin', 'cloxacillin', 'dicloxacillin',
        'piperacillin', 'augmentin', 'amoxicillin clavulanate', 'co-amoxiclav', 'อะม็อกซีซิลลิน', 'แอมพิซิลลิน', 'คล็อกซาซิลลิน'],
      cross: ['cephalosporin']
    },
    {
      id: 'cephalosporin',
      name: L('ยากลุ่มเซฟาโลสปอริน', 'Cephalosporins', '头孢菌素类'),
      terms: ['cephalosporin', 'cephalosporins', 'เซฟาโลสปอริน', 'cephalexin', 'cefalexin', 'cefadroxil', 'cefuroxime', 'cefdinir',
        'cefixime', 'ceftriaxone', 'cefazolin', 'เซฟาเลกซิน', 'เซฟไตรอะโซน'],
      cross: ['penicillin']
    },
    {
      id: 'nsaid',
      name: L('ยาแก้ปวดกลุ่ม NSAIDs (รวมแอสไพริน)', 'NSAID painkillers (incl. aspirin)', '非甾体抗炎药（含阿司匹林）'),
      terms: ['nsaid', 'nsaids', 'เอ็นเสด', 'ibuprofen', 'diclofenac', 'naproxen', 'mefenamic acid', 'mefenamic', 'piroxicam', 'meloxicam',
        'indomethacin', 'ketoprofen', 'aspirin', 'แอสไพริน', 'ไอบูโพรเฟน', 'ไดโคลฟีแนค', 'นาพรอกเซน', 'กรดเมเฟนามิก', 'ponstan', 'voltaren', 'brufen'],
      cross: []
    },
    {
      id: 'sulfonamide',
      name: L('ยาซัลฟา (ซัลโฟนาไมด์)', 'Sulfa drugs (sulfonamides)', '磺胺类药物'),
      terms: ['sulfa', 'sulpha', 'sulfonamide', 'sulphonamide', 'ซัลฟา', 'co-trimoxazole', 'cotrimoxazole', 'bactrim', 'sulfamethoxazole',
        'sulfasalazine', 'โคไตรม็อกซาโซล'],
      cross: []
    },
    {
      id: 'quinolone',
      name: L('ยากลุ่มควิโนโลน', 'Quinolones', '喹诺酮类'),
      terms: ['quinolone', 'quinolones', 'fluoroquinolone', 'ควิโนโลน', 'ciprofloxacin', 'levofloxacin', 'norfloxacin', 'ofloxacin',
        'moxifloxacin', 'ไซโปรฟลอกซาซิน', 'นอร์ฟลอกซาซิน'],
      cross: []
    }
  ];

  // ------------------------------------------------------------------
  // Dose at a glance: the big-number tiles at the top of a drug page.
  // Every value restates the drug's own `usage` text above (which is
  // still shown in full) – never add a number that is not in it.
  //   tiles  k: per | every | daily | max | when
  //          n: the number shown large, u: its unit; or t: a short text
  //   rx     true when the dose is "as prescribed" (shown as a badge)
  //   for    who the numbers are for
  //   note   the one rule people must not miss
  // ------------------------------------------------------------------
  const U = {
    tab: L('เม็ด', 'tablets', '片'),
    tab1: L('เม็ด', 'tablet', '片'),
    mg: L('มก.', 'mg', '毫克'),
    hr: L('ชั่วโมง', 'hours', '小时'),
    time1: L('ครั้ง', 'time', '次')
  };
  const ADULTS = L('ผู้ใหญ่', 'Adults', '成人');
  const SAME_TIME = L('เวลาเดิมทุกวัน', 'Same time daily', '每天固定时间');
  const DOSES = {
    paracetamol: {
      for: L('ผู้ใหญ่และเด็ก 12 ปีขึ้นไป', 'Adults and children 12+', '成人及12岁以上儿童'),
      tiles: [{ k: 'per', n: '1–2', u: U.tab }, { k: 'every', n: '4–6', u: U.hr }, { k: 'max', n: '8', u: U.tab }],
      note: L('ไม่ควรใช้ติดต่อกันเกิน 5 วัน', 'Do not use for more than 5 days in a row', '连续使用不超过5天')
    },
    ibuprofen: {
      for: ADULTS,
      tiles: [{ k: 'per', n: '200–400', u: U.mg }, { k: 'every', n: '6–8', u: U.hr }, { k: 'max', n: '1,200', u: U.mg }],
      note: L('กินทันทีหลังอาหาร พร้อมน้ำเต็มแก้ว', 'Straight after food, with a full glass of water', '饭后立即用一满杯水送服')
    },
    'aspirin-81': {
      rx: true,
      tiles: [{ k: 'daily', n: '1', u: U.time1 }, { k: 'when', t: L('หลังอาหาร', 'After food', '饭后') }],
      note: L('ห้ามหยุดยาเอง', 'Do not stop on your own', '切勿自行停药')
    },
    warfarin: {
      rx: true,
      tiles: [{ k: 'daily', n: '1', u: U.time1 }, { k: 'when', t: SAME_TIME }],
      note: L('ลืมกิน: ห้ามกินยาเพิ่มเป็น 2 เท่า', 'Missed a dose: never double the next one', '漏服时：切勿下次加倍')
    },
    clopidogrel: {
      rx: true,
      tiles: [{ k: 'per', n: '75', u: U.mg }, { k: 'daily', n: '1', u: U.time1 }],
      note: L('ห้ามหยุดยาเองโดยไม่ปรึกษาแพทย์', 'Never stop without asking your doctor', '未经医生同意切勿停药')
    },
    omeprazole: {
      tiles: [{ k: 'per', n: '20', u: U.mg }, { k: 'daily', n: '1', u: U.time1 },
        { k: 'when', t: L('ก่อนอาหารเช้า 30–60 นาที', '30–60 min before breakfast', '早餐前30–60分钟') }],
      note: L('กลืนทั้งแคปซูล ห้ามเคี้ยว', 'Swallow whole – do not chew', '整粒吞服，不要咀嚼')
    },
    amoxicillin: {
      rx: true,
      tiles: [{ k: 'per', n: '500', u: U.mg }, { k: 'every', n: '8', u: U.hr }],
      note: L('กินให้หมดตามที่สั่ง แม้อาการดีขึ้นแล้ว', 'Finish the whole course, even if you feel better', '即使症状好转也要服完整个疗程')
    },
    ciprofloxacin: {
      rx: true,
      tiles: [{ k: 'every', n: '12', u: U.hr }],
      note: L('ดื่มน้ำมาก ๆ และกินให้ครบตามที่สั่ง', 'Drink plenty of water and finish the course', '多喝水，服完整个疗程')
    },
    chlorpheniramine: {
      for: ADULTS,
      tiles: [{ k: 'per', n: '1', u: U.tab1 }, { k: 'every', n: '4–6', u: U.hr }, { k: 'max', n: '6', u: U.tab }],
      note: L('เด็กให้ปรึกษาเภสัชกร', 'Children: ask a pharmacist', '儿童请咨询药剂师')
    },
    metformin: {
      rx: true,
      tiles: [{ k: 'when', t: L('พร้อมอาหารหรือหลังอาหารทันที', 'With or straight after meals', '随餐或饭后立即服用') }]
    },
    amlodipine: {
      rx: true,
      tiles: [{ k: 'daily', n: '1', u: U.time1 }, { k: 'when', t: SAME_TIME }],
      note: L('ห้ามหยุดยาเอง แม้ความดันปกติแล้ว', 'Do not stop, even when your blood pressure is normal', '即使血压正常也不要自行停药')
    },
    simvastatin: {
      rx: true,
      tiles: [{ k: 'daily', n: '1', u: U.time1 }, { k: 'when', t: L('ตอนเย็นหรือก่อนนอน', 'Evening or bedtime', '晚上或睡前') }]
    }
  };
  DRUGS.forEach((d) => { d.dose = DOSES[d.id] || null; });

  window.DRUG_DB = { DRUGS, INTERACTIONS, ALLERGY_GROUPS, L };
})();
