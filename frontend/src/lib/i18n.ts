/**
 * Central UI dictionary (AR-F "UI text must come from a central i18n
 * dictionary, not inline literals"). The product language decision itself is
 * OQ-02; this file is the single place that has to change when it is made.
 *
 * Terminology is the established repository/domain vocabulary
 * (`docs/accounting/domain-contract.md`, `docs/architecture/domain/glossary`):
 * حساب, کد حساب, دفتر کل, تراز آزمایشی, گردش حساب, دوره مالی, سال مالی,
 * حوزه مالی, سازمان. Domain concepts are never renamed for UI taste.
 */
export const fa = {
  app: {
    name: 'وردنا',
    tagline: 'سامانه یکپارچه سازمانی',
    loading: 'در حال بارگذاری…',
    retry: 'تلاش دوباره',
    close: 'بستن',
    cancel: 'لغو',
    apply: 'اعمال',
    reset: 'بازنشانی',
    search: 'جست‌وجو',
    none: '—',
    yes: 'بله',
    no: 'خیر',
    notFoundTitle: 'صفحه پیدا نشد',
    notFoundBody: 'نشانی درخواست‌شده در این سامانه وجود ندارد.',
    backToHome: 'بازگشت به صفحه اصلی',
    skipToContent: 'رفتن به محتوای اصلی',
    settings: 'تنظیمات نمایش',
    themeLabel: 'پوسته',
    themeLight: 'روشن',
    themeDark: 'تیره',
    fontScaleLabel: 'اندازه نوشته',
    fontScaleOptions: {
      compact: 'فشرده',
      default: 'معمولی',
      comfortable: 'راحت',
    } as const,
    profile: 'حساب کاربری',
    viewProfile: 'مشاهده پروفایل',
  },
  toasts: {
    regionLabel: 'اعلان‌ها',
    dismiss: 'بستن اعلان',
  },
  // Request-loading feedback (Thinking Orbs). These strings are owned by the
  // one activity registry in `api/request-activity.ts`; an endpoint never
  // carries Persian copy.
  loading: {
    orbLabel: 'نشانگر انجام عملیات',
    receiving: 'در حال دریافت اطلاعات…',
    saving: 'در حال ذخیره اطلاعات…',
    updating: 'در حال به‌روزرسانی اطلاعات…',
    deleting: 'در حال حذف اطلاعات…',
    processing: 'در حال انجام عملیات…',
    background: 'در حال دریافت اطلاعات در پس‌زمینه…',
  },
  auth: {
    loginTitle: 'ورود به وردنا',
    loginSubtitle: 'برای ادامه، با نام کاربری و گذرواژه سازمانی وارد شوید.',
    username: 'نام کاربری',
    password: 'گذرواژه',
    submit: 'ورود',
    submitting: 'در حال ورود…',
    logout: 'خروج',
    loggingOut: 'در حال خروج…',
    sessionExpired: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.',
    invalidCredentials: 'نام کاربری یا گذرواژه نادرست است.',
    invalidCredentialsHelp:
      'نام کاربری و گذرواژه را بررسی کنید و دوباره تلاش کنید.',
    usernameRequired: 'نام کاربری الزامی است.',
    passwordRequired: 'گذرواژه الزامی است.',
    checkingSession: 'در حال بررسی نشست…',
    signedInAs: 'کاربر جاری',
    changePasswordTitle: 'تغییر اجباری گذرواژه',
    changePasswordSubtitle:
      'برای ادامه استفاده از سامانه، باید گذرواژه حساب کاربری خود را تغییر دهید.',
    currentPassword: 'گذرواژه فعلی',
    newPassword: 'گذرواژه جدید',
    confirmPassword: 'تکرار گذرواژه جدید',
    passwordLengthHint:
      'گذرواژه جدید باید حداقل ۸ نویسه و متفاوت از گذرواژه فعلی باشد.',
    submitChangePassword: 'ثبت گذرواژه جدید و ادامه',
    changingPassword: 'در حال تغییر گذرواژه…',
    changePasswordFailedTitle: 'تغییر گذرواژه انجام نشد',
    currentPasswordRequired: 'وارد کردن گذرواژه فعلی الزامی است.',
    currentPasswordInvalid: 'گذرواژه فعلی نادرست است.',
    newPasswordRequired: 'وارد کردن گذرواژه جدید الزامی است.',
    newPasswordMinLength: 'گذرواژه جدید باید حداقل ۸ نویسه باشد.',
    newPasswordMaxLength: 'گذرواژه جدید نباید بیش از ۱۲۸ نویسه باشد.',
    newPasswordMustDiffer: 'گذرواژه جدید باید با گذرواژه فعلی متفاوت باشد.',
    confirmPasswordRequired: 'تکرار گذرواژه جدید الزامی است.',
    passwordConfirmationMismatch:
      'تکرار گذرواژه جدید با گذرواژه جدید مطابقت ندارد.',
  },
  permissions: {
    forbiddenTitle: 'دسترسی ندارید',
    forbiddenBody:
      'برای مشاهده این بخش، مجوز لازم به حساب کاربری شما داده نشده است.',
    requiredPermission: 'مجوز موردنیاز',
    uxOnlyNote:
      'کنترل‌های دسترسی در رابط کاربری فقط جنبه نمایشی دارند؛ مرجع نهایی مجوزها سرور است.',
  },
  // Installation licensing (ADR-0030). Deliberately separate from
  // `permissions`: مجوز استقرار (license) و مجوز دسترسی (permission) دو
  // واقعیت متفاوت‌اند و متن آن‌ها نباید جای یکدیگر را بگیرد.
  license: {
    checking: 'در حال بررسی مجوز…',
    inactiveTitle: 'مجوز استقرار فعال نیست',
    // ابطال (OD-LIC-17) از هر دلیل وضعیت/تاریخ دیگری بالاتر است و هرگز به‌صورت
    // مهلت (grace) نمایش داده نمی‌شود؛ سند ابطال هم با واردکردن دوبارهٔ مجوز
    // قدیمی برداشته نمی‌شود.
    revokedTitle: 'مجوز این استقرار ابطال شده است',
    revokedBody:
      'برای این استقرار یک سند ابطال امضاشده ثبت شده است. تا صدور و ورود مجوز جدید، بخش‌های کاری در دسترس نیستند. واردکردن دوبارهٔ فایل قدیمی مجوز، ابطال را برنمی‌دارد. این وضعیت به سطح دسترسی حساب کاربری شما مربوط نمی‌شود.',
    revokedAtLabel: 'زمان ابطال',
    inactiveBody:
      'مجوز این استقرار وردنا فعال نیست؛ تا زمان فعال‌شدن مجوز، بخش‌های کاری در دسترس نیستند. این وضعیت به سطح دسترسی حساب کاربری شما مربوط نمی‌شود؛ برای فعال‌سازی با مدیر سامانه تماس بگیرید.',
    errorTitle: 'خطا در دریافت وضعیت مجوز',
    unlicensedTitle: 'این استقرار هنوز مجوزی ندارد',
    unlicensedBody:
      'برای این استقرار وردنا هیچ مجوزی فعال نشده است. مدیر سامانه باید با شناسهٔ استقرار زیر مجوز دریافت و آن را فعال کند. این وضعیت به سطح دسترسی حساب کاربری شما مربوط نیست.',
    installationIdLabel: 'شناسهٔ استقرار',
    // ورود مجوز امضاشده (L-03، ADR-0046): فایل اول، چسباندن متن به‌عنوان راه
    // دوم. متن‌ها به‌عمد از متن «دسترسی» جدا هستند.
    importTitle: 'ورود مجوز نصب',
    importBody:
      'فایل مجوز امضاشده را که برای شناسهٔ استقرار زیر صادر شده است انتخاب کنید. اگر فقط متن یا کد مجوز را دارید، از بخش «چسباندن متن مجوز» استفاده کنید.',
    importFileLabel: 'فایل مجوز',
    importFileHint:
      'فایل مجوز (.vlic یا .json) فقط خوانده و به سرور ارسال می‌شود و در مرورگر ذخیره نمی‌گردد.',
    importSelectedFile: 'فایل انتخاب‌شده:',
    importClearFile: 'حذف فایل انتخاب‌شده',
    importPasteToggle: 'چسباندن متن مجوز به‌جای فایل',
    importPasteHide: 'بستن بخش چسباندن متن',
    importDocumentLabel: 'متن مجوز',
    importDocumentHint:
      'متن کامل مجوز (سند امضاشده یا کد مجوز) را اینجا بچسبانید؛ در مرورگر ذخیره نمی‌شود.',
    importDocumentRequired: 'فایل مجوز را انتخاب کنید یا متن مجوز را بچسبانید.',
    importDocumentTooLong: 'متن مجوز واردشده بیش از اندازهٔ مجاز است.',
    importFileTooLarge: 'فایل انتخاب‌شده از اندازهٔ مجاز بزرگ‌تر است.',
    importFileReadFailed:
      'خواندن فایل مجوز ممکن نشد. فایل دیگری را انتخاب کنید.',
    importSubmit: 'ورود مجوز',
    importSubmitting: 'در حال بررسی و ثبت مجوز…',
    importSuccess:
      'مجوز ثبت شد. اگر نسخهٔ تازه از تاریخی در آینده آغاز شود، از همان زمان فعال می‌شود و مجوز فعلی تا آن زمان معتبر می‌ماند.',
    importUnchanged: 'این مجوز از پیش برای این نصب ثبت شده بود.',
    importRejected:
      'مجوز پذیرفته نشد. فایل یا متن مجوز را بررسی کنید و مجوز معتبر همین نصب را وارد کنید.',
    importInvalid: 'مجوز ارسالی معتبر نیست. فایل یا متن واردشده را بررسی کنید.',
    importConflict:
      'این مجوز با سابقهٔ مجوزهای این نصب تعارض دارد و ثبت نشد؛ مجوز فعلی تغییری نکرده است.',
    // L-04 (PDR-11 §8.6): کاهش ظرفیت/دسترسی که با کارکرد فعلی تعارض دارد.
    importReductionConflict:
      'این نسخه ظرفیت یا دسترسی‌های مجوزی را که جای آن را می‌گیرد کم می‌کند و با کارکرد فعلی نصب تعارض دارد؛ تعداد کنونی و سقف جدید در جزئیات پاسخ آمده است. اعمال این کاهش تنها از طریق عملیات اختصاصیِ دارای دسترسی و با ثبت دلیل ممکن است. چیزی ثبت نشده است.',
    // OQ-87 Option B (PDR-13): بازگردانی پس از پایان پوشش مجوز.
    importPostGapConflict:
      'پوشش مجوز این نصب پایان یافته و این سند با هویت مجوز تازه، پس از آن شروع می‌شود. بازگردانی پس از وقفه تنها از طریق عملیات اختصاصی بازیابی — با دسترسی ویژه و ثبت دلیل — مجاز است و ورود عادی مجوز چنین سناریویی را پوشش نمی‌دهد. چیزی ثبت نشده است.',
    // OQ-87: کد متنی قدیمی (VLIC1) نمی‌تواند عملیات بازیابی را حمل کند.
    importRecoveryRequiresSigned:
      'بازیابی پس از وقفه فقط با سند امضاشده ممکن است؛ کد متنی قدیمی چنین عملیاتی را حمل نمی‌کند. سند بازیابی را به‌صورت امضاشده دریافت کنید.',
    // ابطال امضاشده (OD-LIC-17): «ثبت سند ابطال» یک عمل مستقل از «ورود مجوز»
    // است و مجوز و متن آن هم عمداً جدا از پیام‌های ورود مجوز است. این بخش هیچ
    // مجوزی را فعال نمی‌کند و ادعای بازگردانی ابطال ندارد.
    revocationTitle: 'ثبت سند ابطال امضاشده',
    revocationBody:
      'اگر برای این نصب سند ابطال امضاشده‌ای دریافت کرده‌اید، همان فایل را اینجا وارد کنید. سند فقط وقتی پذیرفته می‌شود که امضای معتبر، همین نصب و همین مشتری و همین مجوز را تأیید کند؛ سند نامعتبر هیچ تغییری در وضعیت ایجاد نمی‌کند.',
    revocationFileLabel: 'فایل سند ابطال',
    revocationFileHint:
      'فایل .json سند ابطال فقط خوانده و به سرور فرستاده می‌شود و در مرورگر ذخیره نمی‌شود.',
    revocationPasteToggle: 'چسباندن متن سند ابطال',
    revocationPasteHide: 'بستن بخش چسباندن متن',
    revocationDocumentLabel: 'متن سند ابطال',
    revocationDocumentHint:
      'متن کامل سند امضاشدهٔ ابطال (VREV1 یا پوشش فایل) را اینجا بچسبانید؛ در مرورگر ذخیره نمی‌شود.',
    revocationDocumentRequired:
      'فایل سند ابطال را انتخاب کنید یا متن آن را بچسبانید.',
    revocationSubmit: 'ثبت سند ابطال',
    revocationSubmitting: 'در حال بررسی و ثبت سند ابطال…',
    revocationSuccess:
      'سند ابطال بررسی و ثبت شد. وضعیت مجوز این نصب از این پس ابطال‌شده است؛ واردکردن دوبارهٔ فایل قدیمی مجوز آن را برنمی‌گرداند.',
    revocationAlreadyApplied:
      'این سند ابطال از پیش ثبت شده بود؛ وضعیت تغییر نکرد.',
    revocationRejected:
      'سند ابطال پذیرفته نشد. امضا، نصب مقصد، مشتری، مجوز هدف و تاریخ سند بررسی شود؛ مجوز فعلی تغییری نکرده است.',
    revocationInvalid:
      'سند ابطال ارسالی معتبر نیست. فایل یا متن واردشده را بررسی کنید.',
    revocationStale:
      'تاریخ این سند ابطال از بازهٔ مجاز گذشته است و ثبت نشد. سند ابطال تازه‌تری از صدورکنندهٔ مجوز بگیرید؛ وضعیت فعلی تغییری نکرده است.',
    revocationConflict:
      'این سند ابطال با سابقهٔ این نصب تعارض دارد و ثبت نشد؛ وضعیت فعلی تغییری نکرده است.',
    revocationForbidden:
      'مجوز لازم برای ثبت سند ابطال را ندارید. با مدیر سامانه تماس بگیرید.',
    revocationFailed: 'ثبت سند ابطال انجام نشد. دوباره تلاش کنید.',
    importForbidden:
      'مجوز لازم برای ورود مجوز نصب را ندارید. با مدیر سامانه تماس بگیرید.',
    importFailed: 'ورود مجوز انجام نشد. دوباره تلاش کنید.',
    // کارت وضعیت مجوز (L-03): نمایش وضعیت ارزیابی‌شدهٔ سرور و مسیر تمدید.
    statusTitle: 'مجوز این نصب',
    statusTypeLabel: 'نوع مجوز',
    statusTypeCommercial: 'تجاری',
    statusTypeDeveloper: 'توسعه‌دهندهٔ رسمی',
    statusTypeLocalDevelopment: 'محلی آزمایشی (غیررسمی)',
    statusDeveloperHolder: 'دارندهٔ توسعه‌دهنده',
    statusUnlicensed: 'هنوز مجوزی ثبت نشده است.',
    statusActive: 'مجوز فعال است',
    statusRevoked: 'مجوز ابطال شده است',
    statusInactive: 'مجوز فعال نیست',
    statusWindow: 'بازهٔ اعتبار',
    statusPerpetual: 'بدون تاریخ پایان',
    statusEffectiveFrom: 'اعتبار از',
    statusCoverageEnd: 'پوشش تا',
    statusCoverageEndHint:
      'پایان زنجیرهٔ پیوستهٔ پوشش این نصب، شامل مجوز زمان‌بندی‌شده‌ای که هنوز آغاز نشده است.',
    statusScheduled: 'مجوز بعدی (زمان‌بندی‌شده)',
    statusScheduledHint:
      'مجوز جدید ثبت شده است و از تاریخ اعتبار خودش فعال می‌شود؛ مجوز فعلی تا آن زمان معتبر می‌ماند. تمدید همیشه از پایان دورهٔ پیشین آغاز می‌شود و دورهٔ جاری را کوتاه نمی‌کند.',
    statusHistory: 'نسخه‌های ثبت‌شده',
    statusHistoryHint:
      'برای تمدید، شناسهٔ عملیات نسخه‌ای را که باید تمدید شود به صدورکنندهٔ مجوز اعلام کنید؛ مجوز تمدیدی همین شناسه را به‌عنوان مرجع تمدید امضا می‌کند.',
    statusOperationId: 'شناسهٔ عملیات',
    statusVersionEffective: 'مؤثر',
    statusVersionScheduled: 'زمان‌بندی‌شده',
    statusVersionRetired: 'جانشین‌شده',
    graceNotice:
      'مهلت ارفاقی مجوز: اعتبار اشتراک پایان یافته است؛ سامانه تا پایان مهلت ارفاقی طبق مجوز کار می‌کند. برای ادامه، مجوز را تمدید کنید.',
    readOnlyNotice:
      'حالت فقط‌خواندنی: مهلت ارفاقی مجوز پایان یافته است؛ مشاهده، گزارش، چاپ و خروجی طبق دسترسی شما ممکن است اما ایجاد یا تغییر اسناد ممکن نیست. برای بازگردانی کامل، مجوز معتبر وارد کنید.',
    graceEndsAtLabel: 'پایان مهلت ارفاقی',
    statusGrace: 'مهلت ارفاقی',
    statusReadOnly: 'فقط‌خواندنی',
    statusSuperseded: 'جانشین‌شده',
  },
  deviceLicensing: {
    title: 'دستگاه‌های ثبت‌شده',
    subtitle:
      'ثبت، غیرفعال‌سازی و جایگزینی دستگاه‌های مجاز این نصب؛ سقف دستگاه از نسخهٔ امضاشدهٔ مجوز خوانده می‌شود.',
    securityNote:
      'کلید خصوصی هرگز در این سامانه وارد یا ذخیره نمی‌شود. کلید خصوصی باید روی خود دستگاه بماند؛ این صفحه فقط کلید عمومی، چالش و امضای جداشده را جابه‌جا می‌کند.',
    loadFailed: 'دریافت فهرست دستگاه‌ها انجام نشد. دوباره تلاش کنید.',
    refresh: 'تازه‌سازی',
    loading: 'در حال دریافت دستگاه‌ها…',
    licenseInactive: 'مجوز فعال نیست؛ تغییر چرخهٔ عمر دستگاه ممکن نیست.',
    quota: 'سقف امضاشدهٔ دستگاه',
    quotaUnspecified: 'در نسخهٔ مؤثر مجوز مشخص نشده است',
    quotaUnlimited: 'نامحدود',
    quotaFinite: '{active} دستگاه فعال از {limit}',
    availableSlots: 'ظرفیت باقی‌مانده',
    activeCount: 'دستگاه فعال',
    deviceInventory: 'فهرست دستگاه‌ها',
    deviceId: 'شناسهٔ دستگاه',
    requestId: 'شناسهٔ درخواست',
    replacementDevices: 'دستگاه قبلی ← دستگاه جدید',
    keyFingerprint: 'اثر انگشت کلید عمومی',
    deviceStatus: 'وضعیت',
    actions: 'عملیات',
    activatedAt: 'زمان فعال‌سازی',
    deactivatedAt: 'زمان غیرفعال‌سازی',
    replacedAt: 'زمان جایگزینی',
    statusActive: 'فعال',
    statusDeactivated: 'غیرفعال‌شده',
    statusReplaced: 'جایگزین‌شده',
    noDevicesTitle: 'دستگاهی ثبت نشده است',
    noDevicesBody:
      'پس از اثبات مالکیت کلید خصوصی روی دستگاه، رکورد آن در این فهرست نگهداری می‌شود.',
    history: 'تاریخچه',
    hideHistory: 'بستن تاریخچه',
    historyEmpty: 'رویدادی برای این دستگاه ثبت نشده است.',
    event: 'رویداد',
    eventTime: 'زمان',
    eventOutcome: 'نتیجه',
    auditReason: 'دلیل',
    outcomeApplied: 'انجام‌شده',
    outcomeRejected: 'ردشده',
    outcomeUnchanged: 'بدون تغییر',
    enroll: 'ثبت دستگاه',
    enrollTitle: 'ثبت دستگاه با اثبات مالکیت کلید',
    enrollDescription:
      'کلید عمومی Ed25519 دستگاه را وارد کنید. سرور یک چالش کوتاه‌عمر می‌سازد؛ دستگاه باید دقیقاً همان متن را با کلید خصوصی خودش امضا کند.',
    publicKey: 'کلید عمومی دستگاه (Base64URL SPKI)',
    publicKeyHint:
      'فقط کلید عمومی را وارد کنید. کلید خصوصی را در این فرم نچسبانید.',
    createChallenge: 'ساخت چالش ثبت',
    creatingChallenge: 'در حال ساخت چالش…',
    challenge: 'متن دقیق چالش برای امضا',
    challengeExpires: 'اعتبار چالش تا',
    challengeCopy: 'کپی متن چالش',
    downloadChallenge: 'دریافت فایل چالش',
    copyText: 'کپی متن',
    challengeCopied: 'متن چالش کپی شد.',
    artifactCopied: 'متن برای انتقال کپی شد.',
    signature: 'امضای Ed25519 دستگاه (Base64URL)',
    signatureHint:
      'امضای detached روی بایت‌های دقیق متن چالش را از دستگاه دریافت و اینجا وارد کنید.',
    activate: 'تأیید امضا و فعال‌سازی',
    activating: 'در حال بررسی امضا…',
    enrollmentSuccess: 'دستگاه با موفقیت ثبت و فعال شد.',
    enrollmentCanceled: 'چالش ثبت بسته شد؛ هیچ دستگاهی فعال نشد.',
    cancelChallenge: 'بستن چالش',
    deactivate: 'غیرفعال‌سازی',
    deactivateTitle: 'غیرفعال‌سازی دستگاه',
    deactivateDescription:
      'این دستگاه از شمار دستگاه‌های فعال خارج می‌شود اما رکورد و تاریخچهٔ آن حذف نمی‌شود. این کار جایگزینی نیست و برای فعال‌سازی دوباره باید فرایند ثبت طی شود.',
    confirmDeactivate: 'غیرفعال‌سازی دستگاه',
    deactivating: 'در حال غیرفعال‌سازی…',
    deactivateSuccess: 'دستگاه غیرفعال شد؛ تاریخچهٔ آن نگهداری می‌شود.',
    replace: 'جایگزینی آفلاین',
    replacementTitle: 'جایگزینی امضاشدهٔ دستگاه',
    replacementDescription:
      'کلید عمومی دستگاه جدید را وارد کنید. دستگاه جدید چالش را امضا می‌کند؛ درخواست امضاشده را به مرجع صدور مجوز منتقل و پاسخ امضاشده را از همان مسیر برگردانید. تا تکمیل تبادل، دستگاه قبلی فعال می‌ماند.',
    createReplacementChallenge: 'ساخت چالش جایگزینی',
    creatingReplacementChallenge: 'در حال ساخت چالش…',
    replacementChallenge: 'چالش دستگاه جدید',
    proveReplacement: 'ثبت اثبات دستگاه جدید',
    provingReplacement: 'در حال بررسی اثبات…',
    replacementExport: 'درخواست امضاشده برای تبادل آفلاین',
    replacementText: 'متن VDRQ1',
    replacementFile: 'فایل JSON امضاشده',
    downloadRequest: 'دریافت فایل درخواست',
    replacementExportHint:
      'فایل یا متن را از مسیر امن به مرجع صدور منتقل کنید. کلید خصوصی در درخواست وجود ندارد.',
    pendingReplacements: 'درخواست‌های جایگزینی',
    replacementState: 'وضعیت درخواست',
    replacementExpires: 'انقضای درخواست',
    replacementChallengeExpires: 'انقضای چالش',
    stateChallenge: 'در انتظار اثبات دستگاه',
    statePending: 'در انتظار پاسخ مرجع صدور',
    stateCompleted: 'تکمیل‌شده',
    stateCancelled: 'لغوشده',
    stateExpired: 'منقضی‌شده',
    cancelReplacement: 'لغو درخواست',
    cancelReplacementTitle: 'لغو قطعی درخواست جایگزینی',
    cancelReplacementDescription:
      'لغو برگشت‌ناپذیر است. حتی اگر پاسخ امضاشده بعداً دریافت شود، این درخواست دیگر تکمیل نمی‌شود و دستگاه فعلی فعال می‌ماند.',
    confirmCancelReplacement: 'لغو قطعی درخواست',
    cancellingReplacement: 'در حال لغو…',
    cancelReplacementSuccess: 'درخواست جایگزینی به‌طور قطعی لغو شد.',
    importResponse: 'ورود پاسخ امضاشدهٔ مرجع صدور',
    importResponseHint:
      'فایل پاسخ VDRP1 یا متن کامل آن را وارد کنید. سرور امضا، کلید مورد اعتماد، انقضا و پیوند درخواست را دوباره بررسی می‌کند.',
    responseFile: 'فایل پاسخ امضاشده',
    responseDocument: 'متن یا محتوای فایل پاسخ',
    responseRequired: 'فایل را انتخاب کنید یا متن پاسخ را وارد کنید.',
    responseTooLong: 'محتوای پاسخ بیش از اندازهٔ مجاز است.',
    responseReadFailed: 'خواندن فایل پاسخ ممکن نشد. فایل دیگری را انتخاب کنید.',
    importResponseSubmit: 'بررسی و تکمیل جایگزینی',
    importingResponse: 'در حال بررسی پاسخ و تکمیل جایگزینی…',
    replacementSuccess:
      'جایگزینی به‌صورت اتمی تکمیل شد؛ دستگاه قبلی نگهداری شد.',
    importResponseSuccess: 'پاسخ امضاشده پذیرفته شد و جایگزینی تکمیل شد.',
    replacementNoActiveDevice: 'برای این دستگاه فعال، جایگزینی ممکن نیست.',
    noReplacements: 'درخواست جایگزینی ثبت نشده است.',
    errorLoad: 'دریافت اطلاعات دستگاه انجام نشد. دوباره تلاش کنید.',
    errorEnrollment: 'ثبت دستگاه انجام نشد. ورودی و مجوز لازم را بررسی کنید.',
    errorActivation:
      'اثبات مالکیت پذیرفته نشد؛ چالش و امضای دستگاه را بررسی کنید.',
    errorDeactivation:
      'غیرفعال‌سازی انجام نشد؛ وضعیت دستگاه را تازه‌سازی کنید.',
    errorReplacement:
      'ساخت درخواست جایگزینی انجام نشد. ورودی و وضعیت دستگاه را بررسی کنید.',
    errorReplacementProof:
      'اثبات دستگاه جدید پذیرفته نشد؛ چالش و امضا را بررسی کنید.',
    errorReplacementExport:
      'دریافت درخواست جایگزینی انجام نشد. دوباره تلاش کنید.',
    errorReplacementImport:
      'پاسخ پذیرفته نشد؛ امضا، اعتبار و شناسهٔ درخواست را بررسی کنید.',
    errorReplacementCancel:
      'لغو درخواست انجام نشد؛ وضعیت آن را تازه‌سازی کنید.',
    errorDeviceLimit: 'سقف امضاشدهٔ دستگاه پر است؛ هیچ تغییری انجام نشد.',
    errorKeyAlreadyUsed:
      'این کلید عمومی پیش‌تر ثبت یا در یک عملیات باز استفاده شده است.',
    errorOperationConflict:
      'عملیات دیگری برای این کلید یا دستگاه در انتظار است.',
    errorExpired: 'چالش یا درخواست منقضی شده است؛ عملیات تازه‌ای آغاز کنید.',
    errorAlreadyUsed: 'این چالش یا پاسخ پیش‌تر مصرف شده است.',
    errorCancelled: 'این درخواست جایگزینی لغو شده و قابل احیا نیست.',
    errorNotPending: 'درخواست جایگزینی دیگر در وضعیت انتظار نیست.',
    errorDeviceNotActive: 'دستگاه انتخاب‌شده فعال نیست.',
    errorNoEntitlement: 'نسخهٔ فعال مجوز، قابلیت امضاشدهٔ دستگاه را ندارد.',
    errorInvalidDocument: 'سند پاسخ معتبر نیست یا امضای آن پذیرفته نشد.',
    copyFailed: 'کپی خودکار ممکن نشد؛ متن را به‌صورت دستی انتخاب کنید.',
    clipboardUnavailable:
      'کپی در این مرورگر در دسترس نیست؛ متن را دستی انتخاب کنید.',
    validationPublicKey: 'کلید عمومی Base64URL را وارد کنید.',
    validationSignature: 'امضای Base64URL دستگاه را وارد کنید.',
  },
  organization: {
    label: 'سازمان',
    switcher: 'انتخاب سازمان',
    loading: 'در حال دریافت سازمان…',
    resolving: 'در حال بررسی سازمان…',
    selectingTitle: 'انتخاب سازمان',
    selectingSubtitle:
      'برای ادامه، سازمانی که می‌خواهید با آن کار کنید را انتخاب کنید.',
    selectingSubmit: 'ادامه',
    invalidTitle: 'سازمان انتخاب‌شده در دسترس نیست',
    invalidBody:
      'سازمان انتخاب‌شده دیگر در دسترس نیست. سازمان دیگری را انتخاب کنید یا دوباره تلاش کنید.',
    emptyTitle: 'سازمانی در دسترس نیست',
    emptyBody:
      'سازمانی برای حساب کاربری شما در دسترس نیست. دسترسی عضویت سازمان را با مدیر سامانه بررسی کنید.',
    errorTitle: 'خطا در دریافت سازمان',
    createFirstTitle: 'ایجاد نخستین سازمان',
    createFirstBody:
      'هنوز هیچ سازمانی در این استقرار ایجاد نشده است. برای شروع کار، نخستین سازمان را ایجاد کنید؛ پس از ایجاد، به‌طور خودکار عضو آن خواهید شد.',
    createFirstCode: 'کد سازمان',
    createFirstName: 'نام سازمان',
    createFirstCodeRequired: 'کد سازمان الزامی است.',
    createFirstNameRequired: 'نام سازمان الزامی است.',
    createFirstSubmit: 'ایجاد سازمان',
    createFirstSubmitting: 'در حال ایجاد سازمان…',
  },
  orgAdmin: {
    title: 'سازمان و اطلاعات پایه',
    subtitle:
      'مدیریت مشخصات سازمان جاری و اطلاعات پایه آن: شعبه‌ها، واحدهای سازمانی، کارکنان و طرف‌حساب‌ها.',
    scopeHint: 'همه رکوردهای این بخش به سازمان جاری تعلق دارند.',

    // --- Shared labels -----------------------------------------------------
    code: 'کد',
    name: 'نام',
    status: 'وضعیت',
    active: 'فعال',
    inactive: 'غیرفعال',
    allStatuses: 'همه وضعیت‌ها',
    createdAt: 'تاریخ ایجاد',
    updatedAt: 'آخرین تغییر',
    actions: 'عملیات',
    view: 'مشاهده',
    edit: 'ویرایش',
    save: 'ذخیره',
    saving: 'در حال ذخیره…',
    back: 'بازگشت',
    dirtyLeaveTitle: 'خروج از فرم',
    dirtyLeaveDescription: 'تغییرات ذخیره‌نشده این فرم از دست می‌رود.',
    dirtyLeaveConfirm: 'خروج بدون ذخیره',
    searchPlaceholder: 'جست‌وجو در کد یا نام',
    filter: 'اعمال فیلتر',
    clear: 'پاک کردن فیلترها',
    notAssigned: 'تعیین نشده',
    identity: 'شناسه سامانه‌ای',
    loading: 'در حال دریافت اطلاعات…',
    optionsTruncated:
      'فهرست انتخاب تا ۲۰۰ مورد نخست نمایش داده می‌شود. اگر مورد موردنظر در فهرست نیست، ابتدا آن را از صفحه مربوط پیدا کنید.',

    // --- Lifecycle (enable/disable — there is no delete) -------------------
    enable: 'فعال‌سازی',
    disable: 'غیرفعال‌سازی',
    enabling: 'در حال فعال‌سازی…',
    disabling: 'در حال غیرفعال‌سازی…',
    enableTitle: 'فعال‌سازی رکورد',
    disableTitle: 'غیرفعال‌سازی رکورد',
    enableBody:
      'با فعال‌سازی، این رکورد دوباره در فهرست‌ها و انتخاب‌های جدید قابل استفاده می‌شود.',
    disableBody:
      'با غیرفعال‌سازی، این رکورد در رکوردهای جدید قابل انتخاب نخواهد بود؛ سوابق موجود دست‌نخورده و قابل مشاهده می‌مانند. این عملیات حذف نیست و بعداً قابل برگشت است.',
    enabled: 'رکورد فعال شد.',
    disabled: 'رکورد غیرفعال شد.',
    noDeleteHint:
      'حذف در این بخش وجود ندارد؛ چرخه عمر اطلاعات پایه با فعال/غیرفعال کردن مدیریت می‌شود.',

    // --- Organization profile ---------------------------------------------
    profile: 'پروفایل سازمان',
    profileDescription:
      'مشخصات سازمان جاری، وضعیت فعال‌بودن و ویرایش کد و نام آن.',
    organizationCode: 'کد سازمان',
    organizationName: 'نام سازمان',
    organizationUpdated: 'مشخصات سازمان به‌روزرسانی شد.',
    organizationEnabled: 'سازمان فعال شد.',
    organizationDisabled: 'سازمان غیرفعال شد.',
    organizationDisableTitle: 'غیرفعال‌سازی سازمان جاری',
    organizationDisableBody:
      'با غیرفعال‌شدن سازمان، ایجاد رکوردهای جدید در دامنه آن متوقف می‌شود؛ داده‌های موجود همچنان قابل مشاهده‌اند. این عملیات روی کل کاربران این سازمان اثر می‌گذارد.',
    organizationEnableTitle: 'فعال‌سازی سازمان جاری',
    organizationEnableBody:
      'با فعال‌شدن سازمان، ایجاد رکوردهای جدید در دامنه آن دوباره ممکن می‌شود.',
    organizationLoadFailed: 'دریافت مشخصات سازمان انجام نشد. دوباره تلاش کنید.',

    // --- Branch ------------------------------------------------------------
    branches: 'شعبه‌ها',
    branchesDescription:
      'شعبه، محل فعالیت سازمان و یکی از ابعاد دامنه‌بندی اسناد و گزارش‌هاست.',
    branch: 'شعبه',
    branchDetail: 'مشخصات شعبه',
    branchCreateTitle: 'ایجاد شعبه',
    branchEditTitle: 'ویرایش شعبه',
    branchCreated: 'شعبه ایجاد شد.',
    branchUpdated: 'شعبه به‌روزرسانی شد.',
    noBranches: 'شعبه‌ای مطابق فیلترهای انتخاب‌شده یافت نشد.',
    branchesLoadFailed: 'دریافت فهرست شعبه‌ها انجام نشد. دوباره تلاش کنید.',
    branchLoadFailed: 'دریافت مشخصات شعبه انجام نشد. دوباره تلاش کنید.',
    newBranch: 'شعبه جدید',

    // --- Department --------------------------------------------------------
    departments: 'واحدهای سازمانی',
    departmentsDescription:
      'واحد سازمانی، بخش وظیفه‌ای درون سازمان است و می‌تواند زیرمجموعه واحد دیگری باشد.',
    department: 'واحد سازمانی',
    departmentDetail: 'مشخصات واحد سازمانی',
    departmentCreateTitle: 'ایجاد واحد سازمانی',
    departmentEditTitle: 'ویرایش واحد سازمانی',
    departmentCreated: 'واحد سازمانی ایجاد شد.',
    departmentUpdated: 'واحد سازمانی به‌روزرسانی شد.',
    noDepartments: 'واحد سازمانی مطابق فیلترهای انتخاب‌شده یافت نشد.',
    departmentsLoadFailed:
      'دریافت فهرست واحدهای سازمانی انجام نشد. دوباره تلاش کنید.',
    departmentLoadFailed:
      'دریافت مشخصات واحد سازمانی انجام نشد. دوباره تلاش کنید.',
    newDepartment: 'واحد سازمانی جدید',
    parentDepartment: 'واحد والد',
    rootDepartment: 'واحد ریشه (بدون والد)',
    allParents: 'همه واحدها',
    parentHint:
      'واحد والد باید در همان سازمان و در زمان انتساب فعال باشد؛ ایجاد حلقه در سلسله‌مراتب پذیرفته نمی‌شود.',
    parentsUnavailable:
      'فهرست واحدهای والد در دسترس نیست؛ انتخاب والد غیرفعال است.',

    // --- Employee ----------------------------------------------------------
    employees: 'کارکنان',
    employeesDescription:
      'اطلاعات پایه کارکنان سازمان (کد، نام، واحد و شعبه). اطلاعات کامل منابع انسانی در دامنه این بخش نیست.',
    employee: 'کارمند',
    employeeDetail: 'مشخصات کارمند',
    employeeCreateTitle: 'ایجاد کارمند',
    employeeEditTitle: 'ویرایش کارمند',
    employeeCreated: 'کارمند ایجاد شد.',
    employeeUpdated: 'اطلاعات کارمند به‌روزرسانی شد.',
    noEmployees: 'کارمندی مطابق فیلترهای انتخاب‌شده یافت نشد.',
    employeesLoadFailed: 'دریافت فهرست کارکنان انجام نشد. دوباره تلاش کنید.',
    employeeLoadFailed: 'دریافت مشخصات کارمند انجام نشد. دوباره تلاش کنید.',
    newEmployee: 'کارمند جدید',
    employeeCode: 'کد کارمندی',
    firstName: 'نام',
    lastName: 'نام خانوادگی',
    fullName: 'نام و نام خانوادگی',
    allDepartments: 'همه واحدهای سازمانی',
    allBranches: 'همه شعبه‌ها',
    noDepartmentAssigned: 'بدون واحد سازمانی',
    noBranchAssigned: 'بدون شعبه',
    departmentsUnavailable:
      'فهرست واحدهای سازمانی در دسترس نیست؛ انتخاب واحد غیرفعال است.',
    branchesUnavailable:
      'فهرست شعبه‌ها در دسترس نیست؛ انتخاب شعبه غیرفعال است.',
    referenceInactiveHint:
      'تنها واحدها و شعبه‌های فعالِ همین سازمان قابل انتخاب هستند.',

    // --- Party -------------------------------------------------------------
    parties: 'طرف‌حساب‌ها',
    partiesDescription:
      'طرف‌حساب، یک رکورد واحد برای مشتری و تأمین‌کننده است؛ نقش‌ها به‌صورت قابلیت روی همان رکورد تعیین می‌شوند.',
    party: 'طرف حساب',
    partyDetail: 'مشخصات طرف حساب',
    partyCreateTitle: 'ایجاد طرف حساب',
    partyEditTitle: 'ویرایش طرف حساب',
    partyCreated: 'طرف حساب ایجاد شد.',
    partyUpdated: 'طرف حساب به‌روزرسانی شد.',
    noParties: 'طرف حسابی مطابق فیلترهای انتخاب‌شده یافت نشد.',
    partiesLoadFailed: 'دریافت فهرست طرف‌حساب‌ها انجام نشد. دوباره تلاش کنید.',
    partyLoadFailed: 'دریافت مشخصات طرف حساب انجام نشد. دوباره تلاش کنید.',
    newParty: 'طرف حساب جدید',
    displayName: 'نام نمایشی',
    legalName: 'نام حقوقی',
    partyType: 'نوع',
    partyTypePerson: 'شخص حقیقی',
    partyTypeOrganization: 'شخص حقوقی',
    allPartyTypes: 'همه انواع',
    capabilities: 'قابلیت‌ها',
    customer: 'مشتری',
    supplier: 'تأمین‌کننده',
    customerCapability: 'قابلیت مشتری',
    supplierCapability: 'قابلیت تأمین‌کننده',
    allCapabilities: 'همه قابلیت‌ها',
    onlyCustomers: 'فقط مشتریان',
    onlySuppliers: 'فقط تأمین‌کنندگان',
    email: 'رایانامه',
    phone: 'تلفن',

    // --- Validation (client-side mirror of the backend DTO limits) ---------
    validation: {
      codeRequired: 'کد الزامی است.',
      codeTooLong: 'کد نباید بیش از ۶۴ نویسه باشد.',
      nameRequired: 'نام الزامی است.',
      nameTooLong: 'نام نباید بیش از ۲۰۰ نویسه باشد.',
      employeeCodeRequired: 'کد کارمندی الزامی است.',
      employeeCodeTooLong: 'کد کارمندی نباید بیش از ۶۴ نویسه باشد.',
      firstNameRequired: 'نام الزامی است.',
      lastNameRequired: 'نام خانوادگی الزامی است.',
      personNameTooLong: 'این نام نباید بیش از ۱۲۰ نویسه باشد.',
      displayNameRequired: 'نام نمایشی الزامی است.',
      partyNameTooLong: 'این نام نباید بیش از ۲۰۰ نویسه باشد.',
      partyTypeRequired: 'نوع طرف حساب را انتخاب کنید.',
      capabilityRequired:
        'دست‌کم یکی از قابلیت‌های «مشتری» یا «تأمین‌کننده» باید انتخاب شود.',
      emailInvalid: 'نشانی رایانامه معتبر نیست.',
      emailTooLong: 'نشانی رایانامه نباید بیش از ۳۲۰ نویسه باشد.',
      phoneTooLong: 'شماره تلفن نباید بیش از ۶۴ نویسه باشد.',
      serverSummary:
        'سامانه اطلاعات ارسالی را نپذیرفت. فیلدهای مشخص‌شده را اصلاح کنید.',
      formSummary: 'برای ذخیره، خطاهای زیر را برطرف کنید.',
    },

    // --- Operation-scoped failures (mapped by error CODE, never by message)
    errors: {
      createFailed: 'ثبت رکورد انجام نشد. دوباره تلاش کنید.',
      updateFailed: 'ذخیره تغییرات انجام نشد. دوباره تلاش کنید.',
      enableFailed: 'فعال‌سازی انجام نشد. دوباره تلاش کنید.',
      disableFailed: 'غیرفعال‌سازی انجام نشد. دوباره تلاش کنید.',
      duplicateCode:
        'این کد در سازمان جاری قبلاً ثبت شده است. کد دیگری بگذارید.',
      businessRule:
        'سامانه این تغییر را با قواعد کسب‌وکار سازگار ندانست. مقادیر انتخاب‌شده را بازبینی کنید.',
      departmentParentRejected:
        'واحد والد انتخاب‌شده پذیرفته نشد: والد باید در همان سازمان و فعال باشد و نباید حلقه ایجاد کند.',
      employeeReferenceRejected:
        'واحد سازمانی یا شعبه انتخاب‌شده پذیرفته نشد: باید متعلق به همین سازمان و فعال باشد.',
      partyCapabilityRejected:
        'طرف حساب باید دست‌کم یکی از قابلیت‌های «مشتری» یا «تأمین‌کننده» را داشته باشد.',
      organizationUpdateRejected:
        'سامانه این تغییر را روی سازمان نپذیرفت. مقدارهای واردشده را بازبینی کنید.',
    },

    // --- Deferred capabilities (no backend contract — see the report) ------
    deferredTitle: 'قابلیت‌های خارج از دامنه این نسخه',
    deferredBody:
      'درون‌ریزی گروهی، خروجی اکسل، تاریخچه تغییرات و نمودار ساختار سازمانی در این نسخه ارائه نشده‌اند.',

    // --- Members (OrganizationMembershipsController) ------------------------
    members: 'اعضای سازمان',
    membersDescription:
      'کاربرانی که به سازمان جاری دسترسی دارند. اعطای عضویت، کاربر را به سازمان اضافه می‌کند؛ سلب عضویت دسترسی او را می‌گیرد.',
    memberList: 'اعضا',
    memberUser: 'کاربر',
    memberSince: 'تاریخ عضویت',
    noMembers: 'عضوی برای این سازمان ثبت نشده است.',
    noMembersFiltered: 'عضوی مطابق فیلترهای انتخاب‌شده یافت نشد.',
    membersLoadFailed: 'دریافت فهرست اعضا انجام نشد. دوباره تلاش کنید.',
    grantMember: 'اعطای عضویت',
    grantMemberTitle: 'اعطای عضویت به کاربر',
    grantMemberBody:
      'کاربر باید پیش‌تر در بخش «کاربران» ایجاد شده باشد. عضو تازه بلافاصله با نقش‌های تعیین‌شده‌اش به سازمان دسترسی می‌گیرد.',
    grantMemberConfirm: 'اعطای عضویت',
    grantingMember: 'در حال اعطای عضویت…',
    memberGranted: 'عضویت اعطا شد.',
    grantFailed: 'اعطای عضویت انجام نشد.',
    alreadyMember: 'این کاربر از قبل عضو سازمان است.',
    userMissing: 'کاربر موردنظر یافت نشد. شناسه کاربر را بازبینی کنید.',
    revokeMember: 'سلب عضویت',
    revokeMemberTitle: 'سلب عضویت کاربر',
    revokeMemberBody:
      'کاربر با سلب عضویت، دسترسی خود به داده‌های این سازمان از دست می‌دهد. نقش‌های او حفظ می‌شوند و با اعطای دوباره عضویت دوباره فعال می‌شوند. این عملیات حذف کاربر نیست.',
    revokeMemberConfirm: 'سلب عضویت',
    revokingMember: 'در حال سلب عضویت…',
    memberRevoked: 'عضویت سلب شد.',
    revokeFailed: 'سلب عضویت انجام نشد.',
    revokeSelfWarning:
      'شما در حال سلب عضویت خودتان هستید؛ پس از این کار به این سازمان دسترسی نخواهید داشت.',
    membersUserUnavailable:
      'برای نمایش نام کاربران به مجوز «مشاهده کاربران» نیاز است؛ شناسه سیستمی کاربر نمایش داده می‌شود.',
    grantPickerUnavailable:
      'برای انتخاب کاربر به مجوز «مشاهده کاربران» نیاز است. شناسه سیستمی (ULID) کاربر را وارد کنید.',
    grantUserRequired: 'انتخاب یا وارد کردن شناسه کاربر الزامی است.',
    userIdInvalid: 'شناسه کاربر باید یک ULID معتبر باشد.',
  },
  /**
   * User account administration (`UsersController`).
   *
   * The backend enforces only "non-empty" on username and password — no
   * complexity policy exists (OQ-06) and none is invented here. Username
   * length mirrors MAX_USERNAME_LENGTH = 64.
   */
  usersAdmin: {
    title: 'کاربران',
    subtitle:
      'حساب‌های کاربری سامانه: ایجاد، ویرایش نام کاربری، فعال/غیرفعال کردن و بازنشانی گذرواژه.',
    scopeHint:
      'حساب‌های کاربری به کل نصب تعلق دارند و به سازمان جاری محدود نیستند.',
    username: 'نام کاربری',
    status: 'وضعیت',
    active: 'فعال',
    inactive: 'غیرفعال',
    allStatuses: 'همه وضعیت‌ها',
    mustChangePasswordNotice: 'برای ادامه باید گذرواژه خود را تغییر دهید.',
    mustChangePassword: 'تغییر گذرواژه در ورود بعدی',
    mustChangePasswordYes: 'الزامی',
    mustChangePasswordNo: 'ندارد',
    createdAt: 'تاریخ ایجاد',
    updatedAt: 'آخرین تغییر',
    actions: 'عملیات',
    view: 'مشاهده',
    edit: 'ویرایش',
    searchPlaceholder: '— بدون جست‌وجو —',
    usersEmpty: 'کاربری مطابق فیلترهای انتخاب‌شده یافت نشد.',
    usersEmptyFirstUse:
      'هنوز کاربری جزء شما ثبت نشده است. نخستین کاربر را ایجاد کنید.',
    listLoadFailed: 'دریافت فهرست کاربران انجام نشد. دوباره تلاش کنید.',

    // Detail
    userDetail: 'مشخصات کاربر',
    userLoadFailed: 'دریافت مشخصات کاربر انجام نشد. دوباره تلاش کنید.',
    userIdentity: 'شناسه کاربر',
    accountState: 'وضعیت حساب',
    accountActions: 'عملیات حساب',
    create: 'ایجاد کاربر',
    update: 'ذخیره تغییرات',

    // Create / edit
    newUser: 'کاربر جدید',
    newUserDescription:
      'حساب کاربری تازه با گذرواژه اولیه ایجاد کنید. کاربر در نخستین ورود با این گذرواژه وارد می‌شود.',
    editUser: 'ویرایش کاربر',
    editUserDescription:
      'تنها نام کاربری قابل ویرایش است. گذرواژه و وضعیت حساب از عملیات اختصاصی خودشان مدیریت می‌شوند.',
    usernameRequired: 'نام کاربری الزامی است.',
    usernameTooLong: 'نام کاربری نباید بیش از ۶۴ نویسه باشد.',
    usernameHint: 'تا ۶۴ نویسه؛ یکتا در کل سامانه.',
    password: 'گذرواژه',
    passwordRequired: 'گذرواژه الزامی است.',
    passwordHint:
      'سیاست پیچیدگی مشخصی اعمال نمی‌شود؛ گذرواژه قابل‌حدس انتخاب نکنید.',
    userCreated: 'کاربر ایجاد شد.',
    userUpdated: 'نام کاربری به‌روزرسانی شد.',
    createFailed: 'ایجاد کاربر انجام نشد. دوباره تلاش کنید.',
    updateFailed: 'ذخیره تغییرات انجام نشد. دوباره تلاش کنید.',
    duplicateUsername:
      'این نام کاربری قبلاً در سامانه ثبت شده است. نام دیگری انتخاب کنید.',
    formSummary: 'برای ذخیره، خطاهای زیر را برطرف کنید.',
    serverValidationSummary:
      'سامانه اطلاعات ارسالی را نپذیرفت. فیلدهای مشخص‌شده را اصلاح کنید.',

    // Lifecycle
    enable: 'فعال‌سازی',
    disable: 'غیرفعال‌سازی',
    enableTitle: 'فعال‌سازی کاربر',
    enableBody:
      'کاربر با فعال‌سازی دوباره می‌تواند وارد سامانه شود؛ گذرواژه و نقش‌های او تغییری نمی‌کنند.',
    disableTitle: 'غیرفعال‌سازی کاربر',
    disableBody:
      'با غیرفعال‌سازی، ورود کاربر مسدود و نشست‌های فعال او باطل می‌شود. حساب حذف نمی‌شود و بعداً قابل فعال‌سازی است.',
    confirming: 'تأیید',
    enabling: 'در حال فعال‌سازی…',
    disabling: 'در حال غیرفعال‌سازی…',
    userEnabled: 'کاربر فعال شد.',
    userDisabled: 'کاربر غیرفعال شد.',
    enableFailed: 'فعال‌سازی انجام نشد. دوباره تلاش کنید.',
    disableFailed: 'غیرفعال‌سازی انجام نشد. دوباره تلاش کنید.',

    // Password reset
    resetPassword: 'بازنشانی گذرواژه',
    resetPasswordTitle: 'بازنشانی گذرواژه کاربر',
    resetPasswordBody:
      'گذرواژه تازه را برای کاربر تعیین کنید. کاربر با گذرواژه فعلی دیگر وارد نمی‌شود و نشست‌های فعال او باطل می‌شوند.',
    newPassword: 'گذرواژه تازه',
    newPasswordRequired: 'گذرواژه تازه الزامی است.',
    resetting: 'در حال بازنشانی…',
    passwordReset: 'گذرواژه کاربر بازنشانی شد.',
    resetFailed: 'بازنشانی گذرواژه انجام نشد. دوباره تلاش کنید.',
  },
  /**
   * Role administration and the permission registry
   * (`RolesController`, `PermissionsController`).
   */
  rolesAdmin: {
    title: 'نقش‌ها',
    subtitle:
      'نقش‌های دسترسی و مجموعه مجوز هر نقش؛ نقش‌ها به کاربران منتسب می‌شوند و مجوزها به نقش‌ها.',
    roleName: 'نام نقش',
    description: 'توضیح',
    permissionCount: 'تعداد مجوزها',
    createdAt: 'تاریخ ایجاد',
    updatedAt: 'آخرین تغییر',
    actions: 'عملیات',
    view: 'مشاهده',
    edit: 'ویرایش',
    noDescription: 'بدون توضیح',
    rolesEmpty: 'نقشی ثبت نشده است. نخستین نقش را ایجاد کنید.',
    rolesEmptyFiltered: 'نقشی مطابق فیلترهای انتخاب‌شده یافت نشد.',
    listLoadFailed: 'دریافت فهرست نقش‌ها انجام نشد. دوباره تلاش کنید.',

    // Detail
    roleDetail: 'مشخصات نقش',
    roleLoadFailed: 'دریافت مشخصات نقش انجام نشد. دوباره تلاش کنید.',
    create: 'ایجاد نقش',
    update: 'ذخیره تغییرات',
    permissionsSection: 'مجوزهای نقش',
    permissionsSectionHint:
      'هر مجوز یک توان مشخص سامانه است (کد به شکل Module.Entity.Action). مجوز اضافه‌شده بلافاصله برای همه کاربرانِ دارای این نقش اثر می‌کند.',
    permissionsEmpty: 'به این نقش هنوز مجوزی منتسب نشده است.',
    permissionCode: 'کد مجوز',
    permissionDescription: 'شرح مجوز',
    addPermission: 'افزودن مجوز',
    addPermissionTitle: 'افزودن مجوز به نقش',
    addPermissionBody:
      'یک مجوز از فهرست ثبت‌شده سامانه انتخاب کنید. افزودن مجوز تکراری پذیرفته نمی‌شود.',
    permissionRequired: 'انتخاب مجوز الزامی است.',
    assigning: 'در حال افزودن…',
    permissionAssigned: 'مجوز به نقش افزوده شد.',
    permissionAlreadyAssigned: 'این مجوز از قبل به نقش منتسب است.',
    permissionMissing:
      'کد مجوز در ثبت سامانه یافت نشد. مجوز دیگری انتخاب کنید.',
    assignFailed: 'افزودن مجوز انجام نشد. دوباره تلاش کنید.',
    removePermission: 'حذف',
    removePermissionTitle: 'حذف مجوز از نقش',
    removePermissionBody:
      'با حذف مجوز، همه کاربران دارای این نقش آن توان را از دست می‌دهند. حذف، خود مجوز را از سامانه پاک نمی‌کند؛ فقط انتساب را می‌شکند.',
    removing: 'در حال حذف…',
    permissionRemoved: 'مجوز از نقش حذف شد.',
    assignmentMissing: 'این انتساب پیش‌تر حذف شده است.',
    removeFailed: 'حذف مجوز انجام نشد. دوباره تلاش کنید.',

    // User assignment
    roleUsersSection: 'انتساب نقش به کاربر',
    roleUsersSectionHint:
      'سامانه فهرست کاربرانِ دارای نقش را ارائه نمی‌کند؛ انتساب تکراری با خطای ۴۰۹ و حذف انتساب‌نشدنی با ۴۰۴ پاسخ می‌گیرد.',
    assignUser: 'انتساب به کاربر',
    assignUserTitle: 'انتساب نقش به کاربر',
    assignUserBody:
      'کاربر باید پیش‌تر در بخش «کاربران» ایجاد شده و عضو سازمان باشد. همین نقش برای سازمان‌های دیگر باید جداگانه انتساب یابد.',
    assignUserConfirm: 'انتساب نقش',
    assigningUser: 'در حال انتساب…',
    userAssigned: 'نقش به کاربر منتسب شد.',
    roleAlreadyAssigned: 'این نقش از قبل به کاربر منتسب است.',
    userOrRoleMissing: 'کاربر یا نقش موردنظر یافت نشد.',
    assignUserFailed: 'انتساب نقش انجام نشد. دوباره تلاش کنید.',
    unassignUser: 'حذف انتساب',
    unassignUserTitle: 'حذف نقش از کاربر',
    unassignUserBody:
      'کاربر این نقش و توان‌های آن را از دست می‌دهد. سایر نقش‌های او دست‌نخورده می‌مانند.',
    unassigningUser: 'در حال حذف انتساب…',
    userUnassigned: 'انتساب نقش حذف شد.',
    unassignFailed: 'حذف انتساب انجام نشد. دوباره تلاش کنید.',
    usersPickerUnavailable:
      'برای انتخاب کاربر به مجوز «مشاهده کاربران» نیاز است. شناسه سیستمی (ULID) کاربر را وارد کنید.',
    userIdRequired: 'انتخاب یا وارد کردن شناسه کاربر الزامی است.',
    userIdInvalid: 'شناسه کاربر باید یک ULID معتبر باشد.',

    // Create / edit
    newRole: 'نقش جدید',
    newRoleDescription:
      'نقش تازه ایجاد کنید. می‌توانید بلافاصله مجموعه اولیه مجوزها را نیز انتخاب کنید؛ این مجموعه در همان تراکنش ایجاد نقش ثبت می‌شود.',
    editRole: 'ویرایش نقش',
    editRoleDescription:
      'نام و توضیح نقش را ویرایش کنید. مجوزها از صفحه خود نقش مدیریت می‌شوند.',
    roleNameRequired: 'نام نقش الزامی است.',
    roleNameTooLong: 'نام نقش نباید بیش از ۱۲۰ نویسه باشد.',
    descriptionTooLong: 'توضیح نباید بیش از ۵۰۰ نویسه باشد.',
    roleCreated: 'نقش ایجاد شد.',
    roleUpdated: 'نقش به‌روزرسانی شد.',
    createFailed: 'ایجاد نقش انجام نشد. دوباره تلاش کنید.',
    updateFailed: 'ذخیره تغییرات انجام نشد. دوباره تلاش کنید.',
    duplicateRoleName: 'نقشی با این نام قبلاً ثبت شده است.',
    formSummary: 'برای ذخیره، خطاهای زیر را برطرف کنید.',
    serverValidationSummary:
      'سامانه اطلاعات ارسالی را نپذیرفت. فیلدهای مشخص‌شده را اصلاح کنید.',
    initialPermissions: 'مجوزهای اولیه',
    initialPermissionsHint:
      'می‌توانید خالی بگذارید و بعداً از صفحه نقش مجوز اضافه کنید.',
    selectedCount: 'انتخاب‌شده: {count} مجوز',
    registryLoadFailed:
      'دریافت فهرست مجوزها انجام نشد؛ انتخاب مجوز غیرفعال است.',
    registrySearchPlaceholder: 'جست‌وجو در کد یا شرح مجوز',
  },
  breadcrumb: {
    label: 'مسیر صفحه',
  },
  nav: {
    dashboard: 'میزکار',
    accounting: 'حسابداری',
    documents: 'اسناد حسابداری',
    accountingDocumentLines: 'ردیف‌های اسناد حسابداری',
    chartTree: 'درخت حساب‌ها',
    accountStatements: 'گردش حساب',
    generalLedger: 'دفتر کل',
    trialBalance: 'تراز آزمایشی',
    inventory: 'انبار',
    inventoryDocuments: 'اسناد انبار',
    inventoryDocumentLines: 'ردیف‌های اسناد انبار',
    inventoryMovements: 'گردش‌های انبار',
    inventoryKardex: 'کاردکس',
    inventoryValuation: 'ارزش‌گذاری موجودی',
    clientDevices: 'دستگاه‌های این نصب',
    admin: 'مدیریت سامانه',
    users: 'کاربران',
    roles: 'نقش‌ها',
    openMenu: 'باز کردن منو',
    closeMenu: 'بستن منو',
    mainMenu: 'منوی اصلی',
    collapseSidebar: 'بستن نوار کناری',
    expandSidebar: 'باز کردن نوار کناری',
    openGroup: 'باز کردن دستهٔ {group}',
    sidebarLabel: 'منوی سامانه',
    globalSearch: 'جست‌وجوی سراسری',
    globalSearchPlaceholder: 'جست‌وجو در بخش‌ها و فرم‌ها (Ctrl+K)…',
    globalSearchEmpty: 'بخشی با این عبارت در دسترسی شما یافت نشد.',
    globalSearchNote:
      'جست‌وجوی سریع در منوها و فرم‌های مجاز نشست جاری (موتور جست‌وجوی سراسری داده‌ها در بک‌اند پیاده‌سازی نشده است).',
  },
  home: {
    title: 'میزکار',
    welcome: 'به وردنا خوش آمدید',
    body: 'برای شروع، یکی از بخش‌های در دسترس را انتخاب کنید. بخش‌هایی که مجوز آن‌ها را ندارید نمایش داده نمی‌شوند.',
    openSection: 'ورود به بخش',
  },
  dashboard: {
    title: 'میزکار',
    subtitle: 'خلاصه وضعیت مالی و عملیاتی سازمان شما',
    trialBalanceReport: 'گزارش تراز',
    newDocument: 'سند جدید',
    newDocumentUnavailable:
      'ایجاد سند در نسخه فعلی فراهم نیست؛ این کنش فقط نمایشی است.',
    periodClosedBanner:
      'دوره مالی «{period}» {status} است. اسناد قطعی آن فقط با سند معکوس (Reversal) قابل اصلاح‌اند.',
    dismissBanner: 'بستن',
    kpiSectionLabel: 'شاخص‌های کلیدی',
    scopeMissingShort: 'حسابداری راه‌اندازی نشده است',
    kpiTotalDebit: 'جمع گردش بدهکار دوره',
    kpiTotalCredit: 'جمع گردش بستانکار دوره',
    kpiTotalNet: 'خالص گردش دوره',
    kpiPeriodsWithTurnover: 'دوره‌های دارای گردش',
    kpiUnit: 'ریال',
    kpiPeriodScope: 'برای دوره انتخاب‌شده',
    kpiAccountsScope: 'در درخت حساب‌ها',
    kpiPeriodsScope: 'در سال مالی انتخاب‌شده',
    chartsSectionLabel: 'نمودارهای روند',
    chartsOperationalLabel: 'نمودارهای عملیاتی',
    chartTurnoverTitle: 'گردش بدهکار و بستانکار دوره‌ها',
    chartTurnoverSubtitle: 'بر پایه پروجکشن تراز حسابداری',
    chartTurnoverDebit: 'بدهکار',
    chartTurnoverCredit: 'بستانکار',
    chartNetTitle: 'خالص گردش دوره‌ها',
    chartNetSubtitle: 'بدهکار منهای بستانکار · میلیونی نمایش داده نمی‌شود',
    chartTopAccountsTitle: 'بزرگ‌ترین گردش‌های حساب‌ها',
    chartTopAccountsSubtitle: 'حساب‌های با بیشترین گردش دوره',
    chartMovementsTitle: 'روند حرکات انبار',
    chartMovementsSubtitle: 'شش بازه اخیر بر پایه آخرین حرکت',
    chartEmpty: 'برای این بخش داده‌ای برای رسم نمودار وجود ندارد.',
    scopeMissing:
      'حوزه مالی یا سال مالی تعریف نشده است؛ راه‌اندازی حسابداری را کامل کنید.',
    chartPeriodShort: 'دوره',
    chartFallback: 'نمایش نمودار در این محیط ممکن نیست.',
    chartAriaPrefix: 'نمودار:',
    documentsSectionLabel: 'آخرین اسناد حسابداری',
    documentsSubtitle: 'آخرین اسناد ثبت‌شده سازمان',
    documentsEmptyTitle: 'سندی ثبت نشده است',
    documentsEmptyBody: 'برای این سازمان هنوز سند حسابداری ثبت نشده است.',
    documentsFilteredEmptyTitle: 'نتیجه‌ای یافت نشد',
    documentsFilteredEmptyBody:
      'برای فیلترهای انتخاب‌شده هیچ سندی بازگردانده نشد.',
    colDocumentNumber: 'شماره سند',
    colDocumentDate: 'تاریخ',
    colDescription: 'شرح',
    colTotal: 'جمع (ریال)',
    colState: 'وضعیت',
    colOrigin: 'منشأ',
    stateDraft: 'پیش‌نویس',
    stateTemporary: 'موقت',
    stateFinal: 'قطعی',
    originManual: 'دستی',
    originSystem: 'سیستمی',
    pageOf: 'صفحه {page} از {count}',
    totalDocuments: 'مجموع اسناد',
    approvalsTitle: 'گردش‌کارهای فعال',
    approvalsSubtitle: 'موضوع‌های دارای گردش‌کار فعال',
    approvalsBadge: 'مورد',
    approvalsActionUnavailable:
      'تصمیم تأیید از میزکار فراهم نیست؛ وضعیت فقط نمایش داده می‌شود.',
    approvalsEmptyTitle: 'گردش‌کاری فعال نیست',
    approvalsEmptyBody:
      'برای این سازمان هیچ موضوعی در گردش‌کار فعال وجود ندارد.',
    inventoryTitle: 'کمترین موجودی انبار',
    inventorySubtitle: 'مرتب‌شده بر اساس موجودی واقعی',
    inventoryAvailable: 'قابل',
    inventoryReserved: 'رزروشده',
    inventoryOnHand: 'موجودی کل',
    inventoryBadge: 'رديف',
    inventoryEmptyTitle: 'موجودی ثبت نشده است',
    inventoryEmptyBody: 'برای این سازمان ردیف موجودی انباری بازگردانده نشد.',
    periodTitle: 'وضعیت دوره مالی',
    periodCurrent: '(جاری)',
    periodOpen: 'باز',
    periodClosed: 'بسته',
    periodSealed: 'سیل‌شده',
    periodEmptyTitle: 'دوره‌ای ثبت نشده است',
    periodEmptyBody: 'برای سال مالی انتخابی هیچ دوره‌ای تعریف نشده است.',
    noPermission: 'دسترسی لازم برای این بخش فراهم نیست.',
    reconciliationTitle: 'مغایرت پروجکشن تراز',
    reconciliationBody:
      'مغایرت بین دفتر کل و پروجکشن تراز از میزکار نمایش داده نمی‌شود. برای بررسی، گزارش تراز آزمایشی را باز کنید.',
    reconciliationCta: 'باز کردن تراز آزمایشی',
  },
  accounting: {
    title: 'حسابداری',
    subtitle: 'گزارش‌های خواندنی حسابداری بر پایه دفتر کل ثبت‌شده.',
    chartTreeDescription:
      'ساختار درختی حساب‌ها با کد، عنوان، سطح و وضعیت برگ/تجمیعی.',
    accountStatementsDescription:
      'مانده ابتدای دوره، گردش‌ها و مانده پایانی یک حساب در یک سال مالی.',
    generalLedgerDescription:
      'ردیف‌های ثبت‌شده دفتر کل با فیلتر حوزه مالی، سال مالی، دوره و حساب.',
    trialBalanceDescription:
      'تراز آزمایشی با مانده ابتدای دوره، گردش بدهکار/بستانکار و مانده پایانی.',
    documentsDescription:
      'فهرست اسناد سازمان با وضعیت پیش‌نویس، موقت و قطعی و چرخه عمر سند.',
  },
  documents: {
    // ---- list workspace -------------------------------------------------
    title: 'اسناد حسابداری',
    subtitle:
      'فهرست اسناد سازمان؛ جست‌وجو، فیلتر، صفحه‌بندی و مرتب‌سازی سمت سرور انجام می‌شود.',
    create: 'ثبت سند',
    refresh: 'تازه‌سازی',
    view: 'مشاهده',
    colNumber: 'شماره سند',
    colDate: 'تاریخ سند',
    colDescription: 'شرح',
    colArea: 'حوزه مالی',
    colTotal: 'جمع (ریال)',
    colState: 'وضعیت',
    colOrigin: 'منشأ',
    colAction: 'عملیات',
    stateDraft: 'پیش‌نویس',
    stateTemporary: 'موقت',
    stateFinal: 'قطعی',
    originManual: 'دستی',
    originSystem: 'سیستمی',
    documentTypeVoucher: 'سند حسابداری',
    emptyTitle: 'سندی ثبت نشده است',
    emptyBody: 'برای این سازمان هنوز سند حسابداری ثبت نشده است.',
    emptyFilteredTitle: 'نتیجه‌ای یافت نشد',
    emptyFilteredBody: 'برای فیلترهای انتخاب‌شده هیچ سندی بازگردانده نشد.',
    // ---- filters --------------------------------------------------------
    filters: 'فیلترها',
    filterState: 'وضعیت سند',
    filterOrigin: 'منشأ',
    filterArea: 'حوزه مالی',
    filterYear: 'سال مالی',
    filterPeriod: 'دوره مالی',
    filterNumber: 'شماره سند',
    allStates: 'همه وضعیت‌ها',
    allOrigins: 'همه منشأها',
    allAreas: 'همه حوزه‌های مالی',
    allYears: 'همه سال‌های مالی',
    allPeriods: 'همه دوره‌های مالی',
    apply: 'اعمال فیلترها',
    clear: 'پاک کردن فیلترها',
    hasActiveFilters: 'فیلترها فعال است',
    // ---- detail ---------------------------------------------------------
    detailTitle: 'سند حسابداری',
    headerSection: 'مشخصات سند',
    number: 'شماره سند',
    date: 'تاریخ سند',
    state: 'وضعیت',
    documentType: 'نوع سند',
    origin: 'منشأ',
    organization: 'سازمان',
    area: 'حوزه مالی',
    year: 'سال مالی',
    period: 'دوره مالی',
    branch: 'شعبه',
    totalDebit: 'جمع بدهکار',
    totalCredit: 'جمع بستانکار',
    linesSection: 'ردیف‌های سند',
    lineNo: 'ردیف',
    account: 'حساب',
    accountCode: 'کد حساب',
    accountTitle: 'نام حساب',
    detail: 'تفصیلی',
    lineDescription: 'شرح ردیف',
    debit: 'بدهکار',
    credit: 'بستانکار',
    referencesSection: 'اسناد مرتبط',
    reverses: 'معکوس‌کنندهٔ سند',
    reversedBy: 'سند معکوس این سند',
    notFoundTitle: 'سند یافت نشد',
    notFoundBody: 'سند درخواست‌شده یافت نشد یا در دامنه دسترسی شما نیست.',
    backToList: 'بازگشت به فهرست اسناد',
    // ---- actions & dialogs ----------------------------------------------
    actionsSection: 'عملیات سند',
    edit: 'ویرایش سند',
    issue: 'صدور سند',
    finalize: 'نهایی‌سازی',
    reverse: 'معکوس کردن سند',
    delete: 'حذف سند',
    issueTitle: 'صدور سند',
    issueDescription:
      'با صدور، شماره سند از سری شماره‌گذاری حوزه مالی تخصیص می‌یابد و وضعیت سند به «موقت» تغییر می‌کند. پس از صدور، حوزه مالی سند قابل تغییر نیست.',
    issueConfirm: 'صدور سند',
    issueLoading: 'در حال صدور…',
    finalizeTitle: 'نهایی‌سازی سند',
    finalizeDescription:
      'پس از نهایی‌سازی، ویرایش مستقیم این سند امکان‌پذیر نیست و سند وارد دفاتر می‌شود.',
    finalizeConfirm: 'نهایی‌سازی',
    finalizeLoading: 'در حال نهایی‌سازی…',
    reverseTitle: 'معکوس کردن سند',
    reverseDescription:
      'یک سند معکوس قطعی جدید با ارقام بدهکار و بستانکار معکوس ایجاد می‌شود و سند اصلی حذف یا ویرایش نمی‌شود. دلیل معکوس کردن الزامی است.',
    reverseConfirm: 'ایجاد سند معکوس',
    reverseLoading: 'در حال ایجاد سند معکوس…',
    reverseReason: 'دلیل معکوس کردن',
    reverseReasonRequired: 'دلیل معکوس کردن الزامی است.',
    deleteTitle: 'حذف سند',
    deleteDescription:
      'این سند غیرقطعی حذف می‌شود. اگر شماره‌ای به آن تخصیص یافته باشد، سابقه تخصیص شماره در سری حوزه مالی باقی می‌ماند.',
    deleteConfirm: 'حذف سند',
    deleteLoading: 'در حال حذف…',
    // ---- compose / edit form ---------------------------------------------
    createTitle: 'ثبت سند حسابداری',
    createSubtitle:
      'سند دستی در حوزه مالی انتخابی ثبت می‌شود؛ شماره‌گذاری، تعیین وضعیت و اعتبارسنجی نهایی بر عهده سرور است.',
    editTitle: 'ویرایش سند حسابداری',
    editSubtitle: 'فقط سندهای پیش‌نویس و موقت قابل ویرایش‌اند.',
    fieldArea: 'حوزه مالی',
    fieldDate: 'تاریخ سند',
    fieldDescription: 'شرح سند',
    addLine: 'افزودن ردیف',
    removeLine: 'حذف ردیف',
    lineAccount: 'حساب',
    lineDetail: 'تفصیلی',
    lineDescriptionOptional: 'شرح ردیف (اختیاری)',
    searchAccounts: 'جست‌وجوی حساب',
    searchDetails: 'جست‌وجوی تفصیلی',
    postableAccountHint: 'فقط حساب‌های فعال و قابل ثبت قابل انتخاب هستند.',
    accountName: 'نام حساب',
    accountSearchPlaceholder: 'کد یا نام حساب…',
    accountAggregateOption: '(تجمیعی — قابل ثبت نیست)',
    accountNotFound: 'حسابی با این کد یا نام یافت نشد.',
    accountPickerLoading: 'در حال دریافت حساب‌ها…',
    accountLinkHint:
      'کد و نام حساب به هم لینک‌اند: با نوشتن کد، نام معتبر همان حساب پر می‌شود و برعکس.',
    accountSuggestions: 'پیشنهادهای حساب',
    detailHint: 'برای این حساب تعیین تفصیلی الزامی است.',
    detailNotRequired: 'این حساب تفصیلی ندارد.',
    linesHint:
      'در هر ردیف فقط یکی از بدهکار یا بستانکار را وارد کنید. کلید Enter به ردیف بعدی می‌رود و Ctrl+S فرم را ذخیره می‌کند.',
    save: 'ذخیره سند',
    saving: 'در حال ذخیره…',
    update: 'ذخیره تغییرات',
    updating: 'در حال ذخیره تغییرات…',
    dirtyLeaveTitle: 'خروج از فرم سند',
    dirtyLeaveDescription: 'تغییرات ذخیره‌نشده این فرم از دست می‌رود.',
    dirtyLeaveConfirm: 'خروج بدون ذخیره',
    notEditableTitle: 'این سند قابل ویرایش نیست',
    notEditableBody:
      'فقط سندهای پیش‌نویس و موقت قابل ویرایش‌اند. سند قطعی با سند معکوس اصلاح می‌شود.',
    areaImmutableHint:
      'حوزه مالی سند صادرشده قابل تغییر نیست؛ شماره سند به سری حوزه مالی تعلق دارد.',
    // ---- validation ------------------------------------------------------
    validation: {
      areaRequired: 'حوزه مالی الزامی است.',
      dateRequired: 'تاریخ سند الزامی است.',
      dateInvalid: 'تاریخ سند معتبر نیست.',
      descriptionRequired: 'شرح سند الزامی است.',
      descriptionTooLong: 'شرح سند حداکثر می‌تواند ۵۰۰ نویسه باشد.',
      minLines: 'حداقل دو ردیف برای سند لازم است.',
      accountRequired: 'انتخاب حساب الزامی است.',
      detailRequired: 'برای این حساب تعیین تفصیلی الزامی است.',
      amountInvalid:
        'مبلغ باید عددی نامنفی با حداکثر ۱۶ رقم صحیح و ۲ رقم اعشار باشد.',
      amountSides:
        'در هر ردیف فقط یکی از مبلغ‌های بدهکار یا بستانکار باید وارد شود.',
      lineDescriptionTooLong: 'شرح ردیف حداکثر می‌تواند ۵۰۰ نویسه باشد.',
      serverSummary: 'اطلاعات ارسالی معتبر نیست. موارد مشخص‌شده را اصلاح کنید.',
    },
    // ---- feedback: success (Toast, after the backend answered) -----------
    created: 'سند با موفقیت ذخیره شد.',
    createdIssued: 'سند ثبت و به حالت «موقت» صادر شد.',
    updated: 'سند با موفقیت به‌روزرسانی شد.',
    issued: 'سند صادر شد.',
    finalized: 'سند قطعی شد.',
    reversed: 'سند معکوس ایجاد شد.',
    deleted: 'سند حذف شد.',
    viewReversal: 'مشاهده سند معکوس',
    // ---- feedback: failures (operation-scoped, code-derived) -------------
    loadListFailed: 'دریافت فهرست اسناد انجام نشد. لطفاً دوباره تلاش کنید.',
    loadDocumentFailed: 'دریافت سند انجام نشد. لطفاً دوباره تلاش کنید.',
    createFailed: 'ذخیره سند انجام نشد. لطفاً دوباره تلاش کنید.',
    updateFailed: 'به‌روزرسانی سند انجام نشد. لطفاً دوباره تلاش کنید.',
    issueFailed: 'صدور سند انجام نشد. لطفاً دوباره تلاش کنید.',
    finalizeFailed: 'نهایی‌سازی سند انجام نشد. لطفاً دوباره تلاش کنید.',
    reverseFailed: 'ایجاد سند معکوس انجام نشد. لطفاً دوباره تلاش کنید.',
    deleteFailed: 'حذف سند انجام نشد. لطفاً دوباره تلاش کنید.',
    noPermissionEdit: 'شما مجوز ویرایش سند را ندارید.',
    noPermissionIssue: 'شما مجوز صدور سند را ندارید.',
    noPermissionFinalize: 'شما مجوز نهایی‌سازی سند را ندارید.',
    noPermissionReverse: 'شما مجوز معکوس کردن سند را ندارید.',
    noPermissionDelete: 'شما مجوز حذف سند را ندارید.',
    // ---- business rules (stable details/problems → Persian UX copy) ------
    business: {
      generic:
        'این درخواست با قواعد حسابداری سازگار نیست. اطلاعات را تازه‌سازی و دوباره تلاش کنید.',
      alreadyFinal:
        'امکان نهایی‌سازی سند وجود ندارد؛ زیرا سند قبلاً قطعی شده است.',
      closedPeriod: 'امکان نهایی‌سازی سند وجود ندارد؛ زیرا دوره مالی بسته است.',
      sealedScope:
        'امکان نهایی‌سازی سند وجود ندارد؛ زیرا سال مالی مهروموم شده است.',
      reverseNotFinal:
        'امکان معکوس کردن سند وجود ندارد؛ زیرا فقط سند قطعی قابل معکوس کردن است.',
      alreadyReversed:
        'امکان معکوس کردن سند وجود ندارد؛ زیرا این سند قبلاً معکوس شده است.',
      unbalanced: 'جمع بدهکار و بستانکار سند برابر نیست.',
      dateUnresolvable:
        'تاریخ سند در هیچ دوره مالی معتبری قرار نمی‌گیرد. تاریخ یا تنظیمات سال مالی را بررسی کنید.',
      scopeClosed:
        'امکان ثبت یا اصلاح سند وجود ندارد؛ زیرا دوره مالی بسته است.',
      scopeSealed:
        'امکان ثبت یا اصلاح سند وجود ندارد؛ زیرا سال یا دوره مالی مهروموم شده است.',
      accountNotPostable:
        'امکان ثبت ردیف وجود ندارد؛ زیرا حساب انتخاب‌شده قابل ثبت نیست. یک حساب قابل ثبت انتخاب کنید.',
      accountDisabled:
        'امکان ثبت ردیف وجود ندارد؛ زیرا حساب انتخاب‌شده غیرفعال است. حساب فعال دیگری انتخاب کنید.',
      numberingSeriesMissing:
        'برای سند حسابداری در این حوزه مالی «سری شماره‌گذاری» تعریف نشده است؛ به همین دلیل سند — حتی اگر متوازن باشد — شماره نمی‌گیرد و ثبت نمی‌شود. مدیر سامانه باید نخست سری شماره‌گذاری نوع سند حسابداری را برای این حوزه مالی پیکربندی کند؛ سپس همین سند را دوباره ثبت کنید.',
      numberingSeriesDisabled:
        'سری شماره‌گذاری سند حسابداری در این حوزه مالی غیرفعال است؛ به همین دلیل سند شماره نمی‌گیرد و ثبت نمی‌شود. مدیر سامانه باید سری را فعال کند؛ سپس همین سند را دوباره ثبت کنید.',
      conflict:
        'سند در فاصله انجام عملیات تغییر کرده است. نسخه جدید را دریافت و تغییرات را دوباره بررسی کنید.',
    },
    // Line-composition problems (`details.problems`, allow-listed) --------
    lineProblems: {
      too_few_lines: 'حداقل دو ردیف برای سند لازم است.',
      missing_debit_side: 'حداقل یک ردیف باید مبلغ بدهکار داشته باشد.',
      missing_credit_side: 'حداقل یک ردیف باید مبلغ بستانکار داشته باشد.',
      unbalanced_document: 'جمع بدهکار و بستانکار سند برابر نیست.',
      invalid_amount: 'مبلغ ردیف باید عددی نامنفی با حداکثر ۲ رقم اعشار باشد.',
      zero_line: 'در هر ردیف یکی از مبلغ‌های بدهکار یا بستانکار باید وارد شود.',
      both_sides_set:
        'در هر ردیف فقط یکی از مبلغ‌های بدهکار یا بستانکار باید وارد شود.',
      detail_required: 'برای حساب انتخاب‌شده تعیین تفصیلی الزامی است.',
      detail_not_allowed: 'برای این حساب تعیین تفصیلی مجاز نیست.',
      detail_not_found: 'تفصیلی انتخاب‌شده یافت نشد یا در دسترس شما نیست.',
      detail_not_postable:
        'تفصیلی انتخاب‌شده قابل ثبت نیست. یک تفصیلی برگ انتخاب کنید.',
      detail_disabled:
        'تفصیلی انتخاب‌شده غیرفعال است. تفصیلی دیگری انتخاب کنید.',
      detail_group_mismatch:
        'تفصیلی انتخاب‌شده به گروه تفصیلی این حساب تعلق ندارد.',
    },
  },
  // ---------------------------------------------------------------------------
  // Inventory — warehouse operations & valuation.
  //
  // Canonical terminology and copy come from the accepted UX/writing
  // contracts, not ad-hoc wording:
  // - `docs/frontend/ux/persian-ux-writing-standard.md` §3.4 (رسید انبار،
  //   صادره انبار، انتقال بین انبار، قیمت تمام‌شده، قیمت‌گذاری مجدد،
  //   در انتظار قیمت تمام‌شده، ارزش‌گذاری نامعتبر، بدون قیمت تمام‌شده…)
  // - `docs/frontend/ux/feedback-standard.md` §5.3/§5.4 (the two-step
  //   backdating dialogs) and §6.2/§11.7 (business-error copy).
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Inventory business documents (C-58): رسید انبار / حواله انبار / انتقال
  // انبار. Vocabulary follows docs/architecture/domain/glossary and the
  // backend's own lifecycle names; no status or action is invented here.
  // ---------------------------------------------------------------------------
  inventoryDocuments: {
    title: 'اسناد انبار',
    subtitle:
      'رسید، حواله و انتقال انبار؛ از پیش‌نویس تا نهایی‌سازی، ثبت حسابداری و ابطال.',
    listTitle: 'اسناد انبار',
    newDocument: 'سند انبار جدید',
    newReceipt: 'رسید انبار جدید',
    newIssue: 'حواله انبار جدید',
    newTransfer: 'انتقال انبار جدید',
    backToList: 'بازگشت به اسناد انبار',
    detailTitle: 'سند انبار',
    notFoundTitle: 'سند انبار پیدا نشد',
    notFoundBody:
      'این سند در سازمان جاری وجود ندارد یا حذف شده است. فهرست اسناد را بررسی کنید.',
    loadFailed: 'دریافت اسناد انبار انجام نشد. دوباره تلاش کنید.',
    detailLoadFailed: 'دریافت سند انبار انجام نشد. دوباره تلاش کنید.',
    emptyFirstUse: 'هنوز سند انباری ثبت نشده است. نخستین سند را بسازید.',
    emptyFiltered: 'برای فیلترهای انتخاب‌شده سندی یافت نشد.',

    kinds: {
      receipt: 'رسید انبار',
      issue: 'حواله انبار',
      transfer: 'انتقال انبار',
      purchase_return: 'برگشت از خرید',
      sales_return: 'برگشت از فروش',
    },
    unsupportedEditKind: 'ویرایش این نوع سند در این فرم پشتیبانی نمی‌شود.',
    statuses: {
      draft: 'پیش‌نویس',
      operational: 'عملیاتی',
      accounting_posted: 'ثبت‌شده در حسابداری',
      immutable: 'قطعی و غیرقابل‌تغییر',
      cancelled: 'ابطال‌شده',
    },

    // Columns
    columnNumber: 'شماره سند',
    columnKind: 'نوع سند',
    columnDate: 'تاریخ سند',
    columnStatus: 'وضعیت',
    columnWarehouse: 'انبار',
    columnLines: 'تعداد ردیف',
    columnUpdatedAt: 'آخرین تغییر',

    // Filters
    kindFilter: 'نوع سند',
    allKinds: 'همه انواع',
    statusFilter: 'وضعیت',
    allStatuses: 'همه وضعیت‌ها',
    allWarehouses: 'همه انبارها',

    // Form
    createTitle: 'ثبت سند انبار',
    createDescription:
      'سند به‌صورت پیش‌نویس ذخیره می‌شود؛ تا زمان نهایی‌سازی هیچ اثری بر موجودی ندارد و شماره نمی‌گیرد.',
    editTitle: 'ویرایش سند انبار',
    editDescription:
      'ویرایش سند عملیاتی، اثر انباری ثبت‌شده را به‌صورت اتمیک اصلاح می‌کند؛ هیچ تغییری بی‌اطلاع شما اعمال نمی‌شود.',
    kindField: 'نوع سند',
    businessDate: 'تاریخ سند',
    warehouse: 'انبار',
    sourceWarehouse: 'انبار مبدأ',
    destinationWarehouse: 'انبار مقصد',
    cost: 'بهای تمام‌شده (اختیاری)',
    costHint:
      'فقط برای رسید و فقط یک ردیف؛ این مبلغ تخصیص ارزش انبار است، نه قیمت خرید.',
    costMultiLineDisabled:
      'تخصیص بها فقط برای رسید تک‌ردیفی پشتیبانی می‌شود؛ برای چند ردیف، سند را تفکیک کنید.',
    issueNoCost:
      'بهای حواله از روش ارزش‌گذاری موجودی محاسبه می‌شود و دستی وارد نمی‌شود.',
    transferNoCost: 'انتقال بین انبارها از نظر ارزش خنثی است.',
    description: 'شرح',
    reference: 'مرجع',
    lines: 'ردیف‌های سند',
    addLine: 'افزودن ردیف',
    removeLine: 'حذف ردیف',
    lineItem: 'کالا',
    lineQuantity: 'مقدار',
    lineUnit: 'واحد',
    lineNumber: 'ردیف',
    lineBaseQuantity: 'مقدار پایه',
    selectPlaceholder: 'انتخاب کنید',
    save: 'ذخیره پیش‌نویس',
    saving: 'در حال ذخیره…',
    saveChanges: 'ثبت تغییرات',
    created: 'سند انبار به‌صورت پیش‌نویس ذخیره شد.',
    updated: 'تغییرات سند انبار ثبت شد.',

    // Validation (client-side mirror of the backend rules)
    itemRequired: 'کالا را انتخاب کنید.',
    unitRequired: 'واحد را انتخاب کنید.',
    quantityRequired: 'مقدار را وارد کنید.',
    quantityPositive: 'مقدار باید عددی بزرگ‌تر از صفر باشد.',
    warehouseRequired: 'انبار را انتخاب کنید.',
    sourceWarehouseRequired: 'انبار مبدأ را انتخاب کنید.',
    destinationWarehouseRequired: 'انبار مقصد را انتخاب کنید.',
    sameWarehouse: 'انبار مبدأ و مقصد باید متفاوت باشند.',
    costInvalid: 'بهای تمام‌شده باید عددی بزرگ‌تر از صفر باشد.',
    linesRequired: 'سند باید دست‌کم یک ردیف داشته باشد.',

    // Lifecycle actions
    finalize: 'نهایی‌سازی',
    finalizing: 'در حال نهایی‌سازی…',
    finalizeTitle: 'نهایی‌سازی سند انبار',
    finalizeDescription:
      'با نهایی‌سازی، شماره سند صادر می‌شود و اثر انباری آن ثبت می‌گردد. این عملیات موجودی انبار را تغییر می‌دهد.',
    finalized: 'سند انبار نهایی شد و اثر انباری آن ثبت گردید.',
    accountingPost: 'ثبت حسابداری',
    accountingPosting: 'در حال ثبت حسابداری…',
    accountingPostTitle: 'ثبت حسابداری سند',
    accountingPostDescription:
      'پس از ثبت حسابداری، سند دیگر مستقیم ویرایش، حذف یا ابطال نمی‌شود و اصلاح آن فقط با سند اصلاحی ممکن است.',
    accountingPosted: 'سند در مرز حسابداری ثبت شد.',
    seal: 'قطعی‌سازی',
    sealing: 'در حال قطعی‌سازی…',
    sealTitle: 'قطعی‌سازی سند',
    sealDescription:
      'سند قطعی، پایان مسیر است: پس از آن هیچ عملیاتی روی این سند پذیرفته نمی‌شود.',
    sealed: 'سند قطعی شد.',
    cancel: 'ابطال سند',
    cancelling: 'در حال ابطال…',
    cancelTitle: 'ابطال سند انبار',
    cancelDescription:
      'اثر انباری این سند با گردش معکوس برگردانده می‌شود. سند و شماره‌اش باقی می‌مانند و شماره دوباره استفاده نمی‌شود.',
    cancelReason: 'دلیل ابطال',
    cancelled: 'سند ابطال شد و اثر انباری آن برگشت خورد.',
    deleteDraft: 'حذف پیش‌نویس',
    deleting: 'در حال حذف…',
    deleteTitle: 'حذف پیش‌نویس سند',
    deleteDescription:
      'این پیش‌نویس حذف می‌شود. سندی که اثر انباری داشته باشد حذف نمی‌شود و فقط ابطال می‌گردد.',
    deleted: 'پیش‌نویس سند حذف شد.',
    edit: 'ویرایش',

    // Edit side effects (OQ-54 / ADR-0040)
    sideEffectTitle: 'این ویرایش اثر انباری ثبت‌شده را تغییر می‌دهد',
    sideEffectDescription:
      'گردش‌های قبلی این سند برگشت می‌خورند و گردش‌های جدید ثبت می‌شوند. این تغییر را تأیید می‌کنید؟',
    sideEffectAcknowledge: 'تغییر اثر انباری را تأیید می‌کنم.',
    repricingTitle: 'تکلیف ارزش‌گذاری',
    repricingDescription:
      'ارزش‌گذاری این کالا در این انبار تحت تأثیر قرار می‌گیرد. تکلیف آن را مشخص کنید؛ هیچ پیش‌فرضی اعمال نمی‌شود.',
    repricingRecalculate: 'قیمت‌گذاری مجدد انجام شود',
    repricingSkip: 'انجام نشود (ارزش‌گذاری نامعتبر می‌ماند)',
    valuationStaleTitle: 'ارزش‌گذاری این سند نامعتبر است',
    valuationStaleBody:
      'شما قیمت‌گذاری مجدد را انجام ندادید؛ ارزش موجودی این کالا تا انجام قیمت‌گذاری مجدد به‌روز نیست.',

    // Backdating (OD-VAL-10/11; transfers: PDR-08 OD-TRF-01…09, C-59C)
    backdateConfirm: 'تاریخ سند از آخرین گردش این کالا قدیمی‌تر است.',

    // Document facts
    numberNotAllocated: 'هنوز شماره نگرفته است',
    finalizedAt: 'زمان نهایی‌سازی',
    accountingPostedAt: 'زمان ثبت حسابداری',
    sealedAt: 'زمان قطعی‌سازی',
    cancelledAt: 'زمان ابطال',
    cancellationReason: 'دلیل ابطال',
    movementLink: 'گردش انبار',
    noMovementYet: 'هنوز گردشی ثبت نشده است',
    outMovement: 'گردش خروج',
    inMovement: 'گردش ورود',
    permissionNote:
      'کنترل دسترسی در این صفحه فقط جنبه نمایشی دارد؛ مرجع نهایی، مجوزهای سرور است.',

    errors: {
      illegalTransition:
        'این تغییر وضعیت مجاز نیست. صفحه را تازه‌سازی کنید تا وضعیت واقعی سند را ببینید.',
      accountingPostedImmutable:
        'سند پس از ثبت حسابداری تغییر نمی‌کند؛ اصلاح آن فقط با سند اصلاحی ممکن است.',
      cancelledImmutable: 'سند ابطال‌شده بخشی از سابقه است و تغییر نمی‌کند.',
      alreadyCancelled: 'این سند پیش‌تر ابطال شده است.',
      deleteForbidden:
        'فقط پیش‌نویس حذف می‌شود؛ سندی که اثر انباری دارد باید ابطال شود.',
    },
  },

  inventory: {
    title: 'عملیات انبار',
    subtitle:
      'ثبت رسید و صادره انبار، انتقال بین انبار و مشاهده گردش‌ها و موجودی.',
    valuationTitle: 'ارزش‌گذاری موجودی',
    valuationSubtitle:
      'وضعیت ارزش موجودی هر کالا در هر انبار؛ کارفهرست حسابداری انبار.',
    movementsTitle: 'گردش‌های انبار',
    movementsSubtitle: 'تاریخچۀ گردش‌های ثبت‌شده انبار سازمان.',
    kardexTitle: 'کاردکس',
    kardexSubtitle: 'گردش کمیت و موجودی جاری یک کالا در یک انبار.',

    // Surfaces on the landing page
    newReceipt: 'ثبت رسید انبار',
    newReceiptDescription:
      'ثبت ورود کالا به انبار؛ قیمت تمام‌شده اختیاری است و می‌تواند بعداً ثبت شود.',
    newIssue: 'ثبت صادره انبار',
    newIssueDescription:
      'ثبت خروج کالا از انبار؛ ارزش خروج را روش قیمت‌گذاری موجودی تعیین می‌کند.',
    newTransfer: 'انتقال بین انبار',
    newTransferDescription:
      'انتقال هم‌زمان کالا بین دو انبار با دو گردش وابسته.',
    movementsDescription: 'تاریخچۀ گردش‌های ثبت‌شده انبار سازمان.',
    kardexDescription: 'گردش کمیت و موجودی جاری یک کالا در یک انبار.',
    valuationDescription:
      'وضعیت ارزش هر کالا در هر انبار و کارفهرست قیمت‌گذاری مجدد.',

    // Form fields
    item: 'کالا',
    warehouse: 'انبار',
    unit: 'واحد',
    quantity: 'مقدار',
    movementDate: 'تاریخ گردش',
    movementDateHint: 'اگر خالی بماند، امروز در نظر گرفته می‌شود.',
    reason: 'توضیح',
    reasonOptionalHint: 'اختیاری.',
    totalCost: 'قیمت کل رسید',
    totalCostHint:
      'اختیاری — ثبت رسید بدون قیمت تمام‌شده مجاز است و بعداً قابل ثبت است.',
    sourceWarehouse: 'انبار مبدأ',
    destinationWarehouse: 'انبار مقصد',
    baseUnit: 'واحد مبنا',
    currentStock: 'موجودی فعلی این کالا در این انبار',

    // Form actions / validation
    submitReceipt: 'ثبت رسید',
    submitIssue: 'ثبت صادره',
    submitting: 'در حال ثبت…',
    submitTransfer: 'ثبت انتقال',
    itemRequired: 'انتخاب کالا الزامی است.',
    warehouseRequired: 'انتخاب انبار الزامی است.',
    sourceWarehouseRequired: 'انتخاب انبار مبدأ الزامی است.',
    destinationWarehouseRequired: 'انتخاب انبار مقصد الزامی است.',
    destinationMustDiffer: 'انبار مقصد باید با انبار مبدأ متفاوت باشد.',
    quantityRequired: 'مقدار الزامی است.',
    quantityPositive: 'مقدار باید عددی مثبت باشد (حداکثر ۴ رقم اعشار).',
    unitRequired: 'انتخاب واحد الزامی است.',
    totalCostInvalid:
      'قیمت کل باید عددی با حداکثر ۲ رقم اعشار باشد؛ مبلغ گرد نمی‌شود.',
    referencesUnavailable:
      'برای ثبت گردش، ابتدا باید کالا و انبار فعال برای این سازمان تعریف شده باشد.',
    referencesLoadingFailed: 'دریافت اطلاعات پایه انبار انجام نشد.',

    // Success feedback
    receiptCreated: 'رسید انبار ثبت شد.',
    issueCreated: 'صادره انبار ثبت شد.',
    transferCreated: 'انتقال انبار ثبت شد.',
    recalculationDone: 'قیمت‌گذاری مجدد انجام شد.',
    recalculationDoneCount: 'گردش به‌روزرسانی شد.',

    // Movement types (persian-ux-writing-standard §3.4 vocabulary)
    movementTypes: {
      inbound: 'رسید انبار',
      outbound: 'صادره انبار',
      transfer_in: 'انتقال به انبار',
      transfer_out: 'انتقال از انبار',
      adjustment_in: 'تعدیل افزایش موجودی',
      adjustment_out: 'تعدیل کاهش موجودی',
      reversal_in: 'معکوس رسید',
      reversal_out: 'معکوس صادره',
      purchase_return: 'برگشت از خرید',
      sales_return: 'برگشت از فروش',
    },

    // Per-movement valuation finality — the backend's own vocabulary
    // (inventory-valuation.ts): unvalued / provisional / valued.
    valuationStatuses: {
      unvalued: 'بدون قیمت تمام‌شده',
      provisional: 'ارزش‌گذاری نامعتبر (موقت)',
      valued: 'قیمت‌گذاری‌شده',
    },

    // Key-level valuation state (states endpoint)
    valuationStateStatuses: {
      valued: 'قیمت‌گذاری‌شده',
      pending_cost: 'در انتظار قیمت تمام‌شده',
      stale: 'ارزش‌گذاری نامعتبر',
    },

    // Movements table
    movementsEmptyFirstUse: 'هنوز گردش انباری ثبت نشده است.',
    movementsEmptyFiltered: 'برای فیلترهای انتخاب‌شده نتیجه‌ای یافت نشد.',
    movementsLoadFailed: 'دریافت گردش‌های انبار انجام نشد. دوباره تلاش کنید.',
    movementTypeFilter: 'نوع گردش',
    allMovementTypes: 'همه انواع',
    dateFrom: 'از تاریخ',
    dateTo: 'تا تاریخ',
    columnDate: 'تاریخ گردش',
    columnType: 'نوع',
    columnItem: 'کالا',
    columnWarehouse: 'انبار',
    columnQuantity: 'مقدار',
    columnBaseQuantity: 'مقدار مبنا',
    columnValuationStatus: 'وضعیت ارزش‌گذاری',
    columnTotalCost: 'ارزش گردش',
    noValue: '—',

    // Kardex
    kardexPickTitle: 'انتخاب کالا و انبار',
    kardexMissingScope: 'برای مشاهده کاردکس، کالا و انبار را انتخاب کنید.',
    kardexEmpty: 'برای این کالا و انبار گردشی ثبت نشده است.',
    kardexLoadFailed: 'دریافت کاردکس انجام نشد. دوباره تلاش کنید.',
    kardexShow: 'نمایش کاردکس',
    kardexColumnDate: 'تاریخ گردش',
    kardexColumnType: 'نوع گردش',
    kardexColumnQuantity: 'گردش',
    kardexColumnBalance: 'موجودی',
    kardexOpening: 'موجودی ابتدای بازه',
    kardexClosing: 'موجودی پایان بازه',

    // Valuation worklist
    valuationEmpty: 'هنوز وضعیت ارزش‌گذاری‌ای برای موجودی ثبت نشده است.',
    valuationEmptyFiltered: 'برای فیلتر انتخاب‌شده نتیجه‌ای یافت نشد.',
    valuationLoadFailed: 'دریافت وضعیت ارزش‌گذاری انجام نشد. دوباره تلاش کنید.',
    valuationStatusFilter: 'وضعیت ارزش‌گذاری',
    allValuationStatuses: 'همه وضعیت‌ها',
    columnValuedQuantity: 'موجودی قیمت‌گذاری‌شده',
    columnUncostedQuantity: 'موجودی بدون قیمت تمام‌شده',
    columnTotalValue: 'ارزش قیمت‌گذاری‌شده',
    columnAverageUnitCost: 'میانگین قیمت تمام‌شده',
    staleSince: 'نامعتبر از',
    noAverageCost: '—',

    // Backdating — the two-step explicit flow (feedback-standard §5.3/§5.4)
    backdateStep1Title: 'سند با تاریخ گذشته',
    backdateStep1Body:
      'تاریخ این سند پیش از آخرین گردش ثبت‌شده برای این کالا در این انبار است. {affectedMovements} گردش بعدی ({affectedValuedMovements} گردش قیمت‌گذاری‌شده) ممکن است دیگر با قیمت تمام‌شده درست محاسبه نشده باشند. ثبت این سند مجاز است، اما تا زمانی که قیمت‌گذاری مجدد انجام نشود، ارزش این کالا در این انبار نامعتبر می‌ماند.',
    backdateStep1Continue: 'ادامه و انتخاب نحوه قیمت‌گذاری',
    backdateStep2Title: 'قیمت‌گذاری مجدد این کالا و انبار',
    backdateStep2Body:
      'یکی از دو گزینه را انتخاب کنید. هیچ‌کدام پیش‌فرض نیست و سیستم به‌تنهایی تصمیم نمی‌گیرد.',
    backdateStep2Recalculate:
      'قیمت‌گذاری مجدد انجام شود — ارزش این کالا در این انبار دوباره از ابتدای گردش‌ها محاسبه می‌شود؛ ارقام گزارش‌های قبلی این کالا و انبار تغییر می‌کند.',
    backdateStep2Skip:
      'انجام نشود — سند ثبت می‌شود و ارزش فعلی دست‌نخورده می‌ماند، اما با برچسب «ارزش‌گذاری نامعتبر» نمایش داده می‌شود تا بعداً اصلاح شود.',
    backdateStep2Submit: 'ثبت سند',

    // Honest stale notice after «انجام نشود» (feedback-standard §5.4)
    staleNoticeTitle: 'ارزش‌گذاری این کالا و انبار نامعتبر است.',
    staleNoticeBody:
      'شما انتخاب کردید قیمت‌گذاری مجدد انجام نشود؛ ارزش ثبت‌شده همین کالا و انبار تا قیمت‌گذاری مجدد، «نامعتبر» باقی می‌ماند و در کارفهرست ارزش‌گذاری نمایش داده می‌شود.',
    staleNoticeRecalculate: 'قیمت‌گذاری مجدد',

    // Recalculation confirm dialog (feedback-standard §5.3)
    recalculateTitle: 'قیمت‌گذاری مجدد',
    recalculateBody:
      'ارزش این کالا در این انبار از ابتدای گردش‌ها دوباره محاسبه می‌شود. ارقام ارزش در گزارش‌های این کالا و انبار تغییر می‌کند؛ مقدار موجودی تغییر نمی‌کند.',
    recalculateSubmit: 'قیمت‌گذاری مجدد',
    recalculateSubmitting: 'در حال قیمت‌گذاری مجدد…',
    recalculateFailed: 'قیمت‌گذاری مجدد انجام نشد.',

    // Business-error copy, mapped by stable code (feedback-standard §6.2)
    errors: {
      insufficientStock:
        'امکان ثبت عملیات انبار وجود ندارد؛ زیرا موجودی قابل استفاده کافی نیست. مقدار را کاهش دهید یا موجودی رزروشده را بررسی کنید.',
      insufficientStockNumbers:
        'موجودی فعلی: {onHand} — مقدار درخواستی: {requested}.',
      backdatedTransferUnresolved:
        'انتقال با تاریخ پیش از آخرین گردش این کالا در یکی از دو انبار، فقط پس از تأیید صریح ثبت می‌شود و به مجوز «قیمت‌گذاری مجدد» نیاز دارد؛ ارزش هر دو انبار از تاریخ انتقال بازمحاسبه می‌شود. تاریخ گردش را اصلاح کنید یا با کاربر دارای این مجوز هماهنگ کنید.',
      recalculationTooLarge:
        'تعداد گردش‌های این کالا در این انبار بیش از حد مجاز یک بار قیمت‌گذاری مجدد است. با پشتیبانی تماس بگیرید تا در بازه‌های کوچک‌تر انجام شود.',
      valuationMethodNotImplemented:
        'این روش قیمت‌گذاری در این نسخه پشتیبانی نمی‌شود. تنها روش فعال، میانگین موزون متحرک است.',
      costAssignmentRequiresInbound:
        'ثبت مستقیم قیمت تمام‌شده فقط برای رسید انبار ممکن است؛ ارزش صادره از روش قیمت‌گذاری محاسبه می‌شود.',
      operationKeyConflict:
        'این درخواست قبلاً با اطلاعات دیگری ثبت شده است. اطلاعات را تازه‌سازی کنید و عملیات را بررسی کنید.',
      recalculatePermission:
        'این عملیات نیاز به مجوز «قیمت‌گذاری مجدد» ارزش موجودی دارد.',
      recalculateFailed: 'قیمت‌گذاری مجدد انجام نشد.',
      postFailed: 'ثبت عملیات انبار انجام نشد. دوباره تلاش کنید.',
      // Server validation issue codes on the cost fields
      costInputAmbiguous: 'فقط یکی از «قیمت واحد» یا «قیمت کل» را وارد کنید.',
      costNotAcceptedForMovementType:
        'برای این نوع گردش، قیمت تمام‌شده پذیرفته نمی‌شود.',
      costPrecisionExceeded:
        'مبلغ واردشده بیش از دو رقم اعشار دارد؛ مبلغ گرد نمی‌شود و باید دقیق وارد شود.',
      generic:
        'سامانه این عملیات انبار را نپذیرفت. مقدارهای واردشده را بازبینی کنید.',
    },
  },

  // Inventory master-data administration (FE-INV-MD): کالا، انبار، واحد،
  // گروه کالا، تبدیل واحد و موجودی. واژگان همان واژگان دامنه است؛ چیزی به
  // سلیقهٔ UI تغییر نمی‌کند.
  inventoryMaster: {
    items: 'کالاها',
    warehouses: 'انبارها',
    units: 'واحدها',
    itemGroups: 'گروه‌های کالا',
    unitConversions: 'تبدیل واحدها',
    balances: 'موجودی انبار',

    itemsDescription: 'تعریف کالاها و ویژگی‌های انباری و تجاری آن‌ها.',
    warehousesDescription: 'تعریف انبارها و سیاست‌های عملیاتی هر انبار.',
    unitsDescription: 'واحدهای شمارش کالا و نماد نمایش آن‌ها.',
    itemGroupsDescription: 'دسته‌بندی سلسله‌مراتبی کالاها.',
    unitConversionsDescription:
      'نسخه‌های تبدیل بین واحدها؛ هر تغییر، یک نسخهٔ تاریخ‌دار جدید است.',
    balancesDescription:
      'موجودی جاری هر کالا در هر انبار؛ مقدار در دسترس، رزروشده و تاریخ آخرین گردش.',

    newItem: 'کالای جدید',
    newWarehouse: 'انبار جدید',
    newUnit: 'واحد جدید',
    newItemGroup: 'گروه جدید',
    newUnitConversion: 'نسخهٔ تبدیل جدید',
    editItem: 'ویرایش کالا',
    editWarehouse: 'ویرایش انبار',
    editUnit: 'ویرایش واحد',
    editItemGroup: 'ویرایش گروه کالا',

    // Shared list chrome
    code: 'کد',
    name: 'نام',
    symbol: 'نماد',
    status: 'وضعیت',
    updatedAt: 'آخرین تغییر',
    actions: 'عملیات',
    view: 'مشاهده',
    edit: 'ویرایش',
    active: 'فعال',
    inactive: 'غیرفعال',
    enable: 'فعال‌سازی',
    disable: 'غیرفعال‌سازی',
    enabling: 'در حال فعال‌سازی…',
    disabling: 'در حال غیرفعال‌سازی…',
    allStatuses: 'همه وضعیت‌ها',
    searchPlaceholder: 'جست‌وجو در کد یا نام…',
    searchPlaceholderItem: 'جست‌وجو در کد، نام یا بارکد…',
    filter: 'اعمال',
    clear: 'پاک‌کردن فیلترها',
    itemGroupFilter: 'گروه کالا',
    allItemGroups: 'همهٔ گروه‌ها',
    itemKindFilter: 'نوع کالا',
    allItemKinds: 'همهٔ انواع',
    branchFilter: 'شعبه',
    allBranches: 'همهٔ شعبه‌ها',
    selectBranch: 'انتخاب شعبه…',
    loadFailed: 'دریافت فهرست انجام نشد. دوباره تلاش کنید.',

    // Shared form chrome
    saving: 'در حال ذخیره…',
    create: 'ثبت',
    update: 'ذخیرهٔ تغییرات',
    dirtyLeaveTitle: 'ترک فرم',
    dirtyLeaveDescription:
      'تغییرات ذخیره‌نشده با خروج از این صفحه از بین می‌رود.',
    dirtyLeaveConfirm: 'خروج بدون ذخیره',
    codeRequired: 'وارد کردن کد الزامی است.',
    codeTooLong: 'کد نباید بیش از ۶۴ نویسه باشد.',
    nameRequired: 'وارد کردن نام الزامی است.',
    nameTooLong: 'نام نباید بیش از ۲۰۰ نویسه باشد.',
    unitCodeTooLong: 'کد واحد نباید بیش از ۳۲ نویسه باشد.',
    unitNameTooLong: 'نام واحد نباید بیش از ۱۲۰ نویسه باشد.',
    unitSymbolTooLong: 'نماد نباید بیش از ۱۶ نویسه باشد.',
    descriptionTooLong: 'توضیحات نباید بیش از ۲۰۰۰ نویسه باشد.',
    barcodeTooLong: 'بارکد نباید بیش از ۶۴ نویسه باشد.',
    duplicateCode:
      'این کد قبلاً در این سازمان ثبت شده است؛ کد دیگری وارد کنید.',
    serverValidationSummary:
      'برخی مقدارهای واردشده پذیرفته نشد؛ موارد مشخص‌شده را اصلاح کنید.',
    errors: {
      createFailed: 'ثبت رکورد انجام نشد. دوباره تلاش کنید.',
      updateFailed: 'ذخیرهٔ تغییرات انجام نشد. دوباره تلاش کنید.',
      enableFailed: 'فعال‌سازی انجام نشد. دوباره تلاش کنید.',
      disableFailed: 'غیرفعال‌سازی انجام نشد. دوباره تلاش کنید.',
      loadFailed: 'دریافت اطلاعات رکورد انجام نشد.',
      notFound:
        'این رکورد پیدا نشد؛ ممکن است حذف شده باشد یا به سازمان دیگری تعلق داشته باشد.',
      forbidden: 'برای این عملیات مجوز لازم را ندارید.',
      conflict: 'این تغییر با وضعیت فعلی سامانه سازگار نیست.',
      businessRule:
        'سامانه این تغییر را نپذیرفت؛ قواعد این رکورد را بازبینی کنید.',
    },
    lifecycle: {
      enableTitle: 'فعال‌سازی رکورد',
      enableBody:
        'با فعال‌سازی، این رکورد برای استفادهٔ مجدد در عملیات و انتخاب‌گرهای سامانه در دسترس قرار می‌گیرد.',
      disableTitle: 'غیرفعال‌سازی رکورد',
      disableBody:
        'با غیرفعال‌سازی، این رکورد در عملیات جدید قابل انتخاب نیست، اما تاریخچه و گزارش‌های قبلی آن سر جای خود می‌ماند. حذف نهایی انجام نمی‌شود.',
    },
    detail: {
      titleSuffix: 'جزئیات',
      identity: 'شناسه',
      flags: 'ویژگی‌ها',
      references: 'ارتباط‌ها',
      audit: 'ثبت و به‌روزرسانی',
      createdAt: 'ایجاد',
      updatedAgo: 'آخرین تغییر',
      id: 'شناسهٔ رکورد',
    },

    // Item kinds — the closed backend vocabulary, untranslated domain terms
    itemKinds: {
      goods: 'کالا',
      service: 'خدمت',
      consumable: 'مصرفی',
      asset: 'دارایی',
      raw_material: 'مادهٔ اولیه',
      semi_finished: 'نیم‌ساخته',
      finished_good: 'محصول نهایی',
      other: 'سایر',
    },

    // Items
    item: 'کالا',
    itemKind: 'نوع کالا',
    itemKindRequired: 'انتخاب نوع کالا الزامی است.',
    itemGroup: 'گروه کالا',
    baseUnit: 'واحد مبنا',
    baseUnitRequired: 'انتخاب واحد مبنا الزامی است.',
    baseUnitHint: 'هر مقدار از این کالا در همین واحد ذخیره می‌شود.',
    description: 'توضیحات',
    barcode: 'بارکد',
    flags: 'ویژگی‌های کالا',
    isStockable: 'قابل انبارش',
    isStockableHint: 'کالای غیرقابل انبارش وارد موجودی نمی‌شود.',
    isPurchasable: 'قابل خرید',
    isSellable: 'قابل فروش',
    isValued: 'دارای ارزش',
    isValuedHint: 'کالای دارای ارزش باید قابل انبارش باشد.',
    requiresLot: 'نیازمند شمارهٔ بچ (Lot)',
    requiresSerial: 'نیازمند شمارهٔ سری',
    requiresExpiry: 'نیازمند تاریخ انقضا',
    allowNegativeStock: 'اجازهٔ موجودی منفی',
    allowNegativeStockHint:
      'خالی = پیروی از سیاست انبار؛ فعال = مجاز در همهٔ انبارها؛ غیرفعال = ممنوع در همهٔ انبارها.',
    noItemGroup: 'بدون گروه',
    noItemGroupHint: 'خالی = کالا بدون گروه.',
    selectUnit: 'انتخاب واحد…',
    itemKindImmutableHint: 'نوع کالا پس از ثبت قابل تغییر نیست.',
    negativeStockFollow: 'پیروی از سیاست انبار',
    negativeStockAllow: 'مجاز (نادیده‌گرفتن سیاست انبار)',
    negativeStockForbid: 'ممنوع (نادیده‌گرفتن سیاست انبار)',
    capabilities: 'قابلیت‌ها',
    unitMissingHint:
      'ابتدا از بخش «واحدها» یک واحد تعریف کنید؛ انتخاب واحد مبنا الزامی است.',
    itemCreated: 'کالا ثبت شد.',
    itemUpdated: 'تغییرات کالا ذخیره شد.',
    itemEnabled: 'کالا فعال شد.',
    itemDisabled: 'کالا غیرفعال شد.',
    itemsEmptyFirstUse: 'هنوز کالایی تعریف نشده است. اولین کالا را بسازید.',
    itemsEmptyFiltered: 'برای فیلترهای انتخاب‌شده کالایی یافت نشد.',
    unitRequiredServerField: 'واحد مبنا',

    // Warehouses
    branch: 'شعبه',
    branchRequired: 'انتخاب شعبه الزامی است.',
    branchHint: 'انبار باید به یک شعبهٔ فعال همین سازمان تعلق داشته باشد.',
    warehousePolicies: 'سیاست‌های انبار',
    allowNegativeStockPolicy: 'سیاست موجودی منفی (پیش‌فرض انبار)',
    reservationsReduceAvailable: 'رزروها از مقدار در دسترس کم شوند',
    reservationsReduceAvailableHint:
      'رزروها هرگز موجودی فیزیکی (on-hand) را تغییر نمی‌دهند؛ این گزینه فقط عدد «در دسترس» را محاسبه می‌کند.',
    accountingPostingMode: 'حالت ثبت حسابداری',
    accountingPostingModeHint:
      'نحوهٔ صدور سند حسابداری هنگام نهایی‌شدن اسناد این انبار.',
    postingModes: {
      direct_final: 'مستقیم و قطعی',
      draft: 'پیش‌نویس برای حسابدار',
    },
    noBranchesHint:
      'ابتدا از بخش «ساختار سازمان» یک شعبه برای این سازمان تعریف کنید.',
    warehouseCreated: 'انبار ثبت شد.',
    warehouseUpdated: 'تغییرات انبار ذخیره شد.',
    warehouseEnabled: 'انبار فعال شد.',
    warehouseDisabled: 'انبار غیرفعال شد.',
    warehousesEmptyFirstUse:
      'هنوز انباری تعریف نشده است. اولین انبار را بسازید.',
    warehousesEmptyFiltered: 'برای فیلترهای انتخاب‌شده انباری یافت نشد.',

    // Units
    unitSymbol: 'نماد',
    unitSymbolHint: 'نماد کوتاه نمایش، مثل «عدد» یا «کیلوگرم» (اختیاری).',
    unitCreated: 'واحد ثبت شد.',
    unitUpdated: 'تغییرات واحد ذخیره شد.',
    unitEnabled: 'واحد فعال شد.',
    unitDisabled: 'واحد غیرفعال شد.',
    unitsEmptyFirstUse: 'هنوز واحدی تعریف نشده است. اولین واحد را بسازید.',
    unitsEmptyFiltered: 'برای فیلترهای انتخاب‌شده واحدی یافت نشد.',

    // Item groups
    parentGroup: 'گروه والد',
    parentGroupHint: 'خالی = گروه ریشه.',
    noParent: 'گروه ریشه',
    itemGroupCreated: 'گروه کالا ثبت شد.',
    itemGroupUpdated: 'تغییرات گروه ذخیره شد.',
    itemGroupEnabled: 'گروه کالا فعال شد.',
    itemGroupDisabled: 'گروه کالا غیرفعال شد.',
    itemGroupsEmptyFirstUse:
      'هنوز گروهی تعریف نشده است. اولین گروه کالا را بسازید.',
    itemGroupsEmptyFiltered: 'برای فیلترهای انتخاب‌شده گروهی یافت نشد.',

    // Unit conversions — effective-dated versions, never edited in place
    conversionScope: 'دامنه',
    conversionScopes: {
      global: 'سراسری (بین دو واحد)',
      item: 'مخصوص یک کالا',
    },
    conversionItem: 'کالای هدف',
    conversionItemRequired:
      'برای دامنهٔ «مخصوص یک کالا»، انتخاب کالا الزامی است.',
    fromUnit: 'واحد مبدأ',
    toUnit: 'واحد مقصد',
    toUnitHint: 'معمولاً واحد مبنای کالا است.',
    factor: 'ضریب تبدیل',
    factorHint: 'مثلاً ۱۲ یعنی هر ۱ واحد مبدأ برابر ۱۲ واحد مقصد است.',
    factorRequired: 'وارد کردن ضریب تبدیل الزامی است.',
    factorInvalid: 'ضریب باید عددی مثبت با حداکثر ۶ رقم اعشار باشد.',
    validFrom: 'تاریخ شروع اعتبار',
    validTo: 'تاریخ پایان اعتبار (اختیاری)',
    validToHint: 'خالی = باز تا اطلاع بعدی؛ نسخهٔ جدید، نسخهٔ قبلی را می‌بندد.',
    fromUnitRequired: 'انتخاب واحد مبدأ الزامی است.',
    toUnitRequired: 'انتخاب واحد مقصد الزامی است.',
    itemFilter: 'کالا',
    allItems: 'همهٔ کالاها',
    columnFactor: 'ضریب',
    columnValidFrom: 'شروع اعتبار',
    columnValidTo: 'پایان اعتبار',
    openEnded: 'باز',
    superseded: 'بسته‌شده',
    current: 'جاری',
    conversionCreated: 'نسخهٔ تبدیل ثبت شد.',
    conversionsEmptyFirstUse:
      'هنوز نسخهٔ تبدیلی ثبت نشده است. اولین تبدیل را بسازید.',
    conversionsEmptyFiltered: 'برای فیلترهای انتخاب‌شده نسخهٔ تبدیلی یافت نشد.',
    conversionsLoadFailed: 'دریافت نسخه‌های تبدیل انجام نشد.',
    conversionNoEditNote:
      'نسخه‌های تبدیل هرگز ویرایش نمی‌شوند؛ برای تغییر، یک نسخهٔ تاریخ‌دار جدید بسازید.',

    // Balances
    warehouseFilter: 'انبار',
    allWarehouses: 'همهٔ انبارها',
    onHand: 'موجودی فیزیکی',
    reserved: 'رزروشده',
    available: 'در دسترس',
    lastMovementDate: 'آخرین گردش',
    balancesEmptyFirstUse:
      'هنوز موجودی‌ای ثبت نشده است؛ با ثبت رسید انبار موجودی شکل می‌گیرد.',
    balancesEmptyFiltered: 'برای فیلترهای انتخاب‌شده موجودی‌ای یافت نشد.',
    balancesLoadFailed: 'دریافت موجودی‌ها انجام نشد. دوباره تلاش کنید.',
    seeKardex: 'کاردکس',
    totalRows: 'ردیف',
  },
  accountingPeriod: {
    back: 'بازگشت',
    new: 'دورهٔ جدید',
    createTitle: 'ایجاد دورهٔ حسابداری',
    actions: 'عملیات',
    sequenceHint: 'شمارهٔ پیشنهادی (قابل تغییر)',
    yearRangeHint: 'بازهٔ سال مالی',
    yearNotOpen: 'برای ایجاد دوره، سال مالی باید باز و فعال باشد.',
    yearSealed:
      'سال مالی مهر شده است؛ برای بستن یا بازگشایی دوره ابتدا رفع مهر کنید.',
    yearViewRequired:
      'بدون مجوز مشاهدهٔ سال مالی، شناسهٔ سال را وارد کنید؛ سرور مالکیت، وضعیت و بازه را بررسی می‌کند.',
    yearIdHint: 'شناسهٔ ۲۶ نویسه‌ای سال مالی در سازمان جاری (ULID)',
    yearIdInvalid: 'شناسهٔ سال مالی باید ULID معتبر ۲۶ نویسه‌ای باشد.',
    outsideYear: 'بازهٔ دوره باید در بازهٔ سال مالی باشد.',
    reason: 'دلیل',
    reasonRequired: 'دلیل عملیات الزامی است (حداکثر ۵۰۰ نویسه).',
    transitionBody:
      'تغییر وضعیت دوره ثبت می‌شود و برای ردگیری نیاز به دلیل دارد.',
    transitionFailed: 'تغییر وضعیت دوره انجام نشد. دوباره تلاش کنید.',
    conflict:
      'وضعیت دوره تغییر کرده است. فهرست را تازه‌سازی و دوباره تلاش کنید.',
    businessRule: 'این عملیات با وضعیت دوره یا سال مالی مجاز نیست.',
    transitions: {
      close: 'بستن دوره',
      reopen: 'بازگشایی دوره',
      seal: 'مهر دوره',
    },
  },
  accountAdmin: {
    edit: 'ویرایش حساب',
    editTitle: 'ویرایش حساب',
    enable: 'فعال کردن حساب',
    disable: 'غیرفعال کردن حساب',
    enableBody: 'این حساب برای استفاده دوباره فعال می‌شود.',
    disableBody:
      'حساب برای ثبت‌های جدید و ایجاد فرزند غیرفعال می‌شود؛ سوابق حفظ می‌شوند.',
    enabled: 'حساب فعال شد.',
    disabled: 'حساب غیرفعال شد.',
    save: 'ذخیره تغییرات',
    saved: 'تغییرات حساب ذخیره شد.',
    saving: 'در حال ذخیره…',
    saveFailed: 'ذخیره حساب انجام نشد. داده‌ها را بررسی و دوباره تلاش کنید.',
    codeImmutable: 'کد حساب پس از ایجاد قابل تغییر نیست.',
    rootOnlyHint:
      'بدون دسترسی مشاهدهٔ حساب‌ها و پیکربندی، فقط می‌توانید حساب ریشه با کد کامل بسازید؛ شکل کد را بک‌اند بررسی می‌کند.',
    groupNone: 'بدون گروه تفصیلی',
    groupSelect: 'انتخاب گروه تفصیلی',
    groupSearch: 'جست‌وجوی گروه تفصیلی',
    groupLoadFailed: 'فهرست گروه‌های تفصیلی دریافت نشد.',
    parentUnchanged: 'حساب والد فعلی',
    groupUnchanged: 'گروه تفصیلی فعلی',
    parentCannotBeSelf: 'حساب نمی‌تواند والد خودش باشد.',
    groupUnavailable: 'نام گروه تفصیلی در دسترس نیست.',
    unlink: 'جدا کردن گروه تفصیلی',
    unlinkTitle: 'جدا کردن گروه تفصیلی از حساب',
    unlinkWarning:
      'این تغییر باعث حذف ارتباط بین تفصیلی و کد حساب می‌شود و تمامی گردش‌های تفصیلی در سندهایی که کدحساب مدنظر گردش داشته باشد حذف خواهد شد . قبل از انجام این کار از دیتا بیس بکاپ بگیرید',
    unlinkAcknowledge:
      'مسئولیت این عملیات را می‌پذیرم و از پایگاه داده نسخهٔ پشتیبان دارم.',
    unlinkSuccess: 'گروه تفصیلی از حساب جدا شد.',
    unlinkFailed:
      'جدا کردن گروه تفصیلی انجام نشد. وضعیت حساب را بررسی و دوباره تلاش کنید.',
  },
  masterData: {
    title: 'اطلاعات پایه حسابداری',
    description:
      'تعریف‌های پایه و ساختار موردنیاز برای عملیات حسابداری سازمان.',
    financialAreas: 'حوزه‌های مالی',
    financialAreasDescription:
      'حوزه مالی، دفاتر مالی مستقل یک سازمان را مشخص می‌کند و سال‌های مالی درون آن تعریف می‌شوند.',
    fiscalYears: 'سال‌های مالی',
    fiscalYearsDescription:
      'هر سال مالی به یک حوزه مالی تعلق دارد و دوره‌های مالی آن سال را در بر می‌گیرد.',
    periods: 'دوره‌های مالی',
    periodsDescription:
      'دوره‌های مالی، بازه‌های عملیاتی یک سال مالی هستند؛ وضعیت آن‌ها مستقیماً از سامانه نمایش داده می‌شود.',
    accounts: 'حساب‌ها',
    accountsDescription:
      'فهرست صفحه‌بندی‌شده حساب‌ها با فیلترهای پشتیبانی‌شده توسط سامانه.',
    accountDetail: 'مشخصات حساب',
    organizationScope: 'سازمان جاری',
    code: 'کد',
    name: 'نام',
    status: 'وضعیت',
    defaultArea: 'حوزه پیش‌فرض',
    active: 'فعال',
    inactive: 'غیرفعال',
    allStatuses: 'همه وضعیت‌ها',
    open: 'باز',
    closed: 'بسته',
    sealed: 'مهروموم‌شده',
    startDate: 'تاریخ شروع',
    endDate: 'تاریخ پایان',
    financialArea: 'حوزه مالی',
    fiscalYear: 'سال مالی',
    sequence: 'شماره دوره',
    level: 'سطح',
    parent: 'حساب والد',
    rootAccount: 'حساب ریشه',
    postability: 'قابلیت ثبت',
    postable: 'قابل ثبت',
    aggregate: 'تجمیعی',
    nature: 'ماهیت',
    natureDebit: 'بدهکار',
    natureCredit: 'بستانکار',
    natureDual: 'دوگانه',
    accountType: 'نوع حساب',
    balanceSheet: 'ترازنامه‌ای',
    incomeStatement: 'سود و زیانی',
    memorandum: 'انتظامی',
    searchPlaceholder: 'جست‌وجو در کد یا نام',
    filter: 'اعمال فیلتر',
    clear: 'پاک کردن فیلترها',
    view: 'مشاهده',
    viewStatement: 'مشاهده گردش حساب',
    noFinancialAreas: 'هنوز حوزه مالی برای این سازمان ثبت نشده است.',
    noFiscalYears: 'برای حوزه انتخاب‌شده سال مالی ثبت نشده است.',
    noPeriods: 'برای سال مالی انتخاب‌شده دوره مالی ثبت نشده است.',
    noAccounts: 'حسابی مطابق فیلترهای انتخاب‌شده یافت نشد.',
    loadFailed: 'دریافت اطلاعات پایه حسابداری انجام نشد. دوباره تلاش کنید.',
    selectFinancialArea: 'همه حوزه‌های مالی',
    selectFiscalYear: 'همه سال‌های مالی',
    contextHint: 'حوزه مالی ← سال مالی ← دوره مالی',
    parentUnavailable: 'اطلاعات حساب والد در این پاسخ وجود ندارد.',
    detailGroup: 'گروه تفصیلی',
    notAssigned: 'تعیین نشده',
    openPeriod: 'گشودن دوره مالی',
    openPeriodTitle: 'گشودن دوره مالی جدید',
    openPeriodBody:
      'دوره در سال مالی انتخاب‌شده گشوده می‌شود و از لحظه ایجاد «باز» است؛ تاریخ‌ها باید در بازه همان سال مالی باشند.',
    opening: 'در حال گشودن…',
    periodTitle: 'عنوان دوره',
    titleRequired: 'عنوان الزامی است.',
    sequenceRequired: 'شماره دوره باید عدد صحیح مثبت باشد.',
    fiscalYearRequired: 'سال مالی را انتخاب کنید.',
    selectFiscalYearOption: 'یک سال مالی انتخاب کنید',
    startDateRequired: 'تاریخ شروع الزامی است.',
    endDateRequired: 'تاریخ پایان الزامی است.',
    dateFormat: 'تاریخ معتبر وارد کنید.',
    dateRange: 'تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.',
    setupChart: 'راه‌اندازی ساختار حساب‌ها',
    setupChartTitle: 'تعریف و فعال‌سازی ساختار کدینگ و پیکربندی حسابداری',
    setupChartBody:
      'بک‌اند برای ساخت حساب ریشه، هم «ساختار کدینگ» فعال و هم «پیکربندی حسابداری» فعال با سطوح هم‌شکل می‌خواهد. هر دو از همین سطوحی که شما تعریف می‌کنید ساخته و فعال می‌شوند؛ هیچ الگوی پیش‌فرضی تحمیل نمی‌شود.',
    setupChartDone: 'ساختار کدینگ و پیکربندی حسابداری فعال شدند.',
    structureCode: 'کد ساختار',
    structureName: 'نام پیکربندی',
    levelTitle: 'عنوان سطح',
    digitLength: 'تعداد ارقام',
    levelPostableDefault: 'قابل ثبت به‌صورت پیش‌فرض',
    addLevel: 'افزودن سطح',
    removeLevel: 'حذف سطح',
    levelRow: 'سطح',
    codeRequired: 'کد الزامی است.',
    nameRequired: 'نام الزامی است.',
    levelsRequired: 'دست‌کم یک سطح با عنوان و تعداد ارقام معتبر تعریف کنید.',
    activating: 'در حال فعال‌سازی…',
    activateChart: 'فعال‌سازی ساختار حساب‌ها',
    chartReady: 'ساختار حساب‌ها فعال است؛ می‌توانید حساب بسازید.',
    createAccount: 'ایجاد حساب',
    createAccountTitle: 'ایجاد حساب جدید',
    createAccountBody:
      'فقط «کد محلی» همین سطح را وارد کنید؛ کد کامل حساب از کد والد و کد محلی ساخته می‌شود و پیش‌نمایش آن زنده نمایش داده می‌شود. سطح حساب از والد مشتق می‌شود و اعتبارسنجی نهایی (والد، سطح، طول بخش و یکتایی کد کامل) با سرور است.',
    accountCode: 'کد حساب',
    localCode: 'کد محلی این سطح',
    localCodeRequired: 'کد محلی الزامی است.',
    localCodeDigits: 'کد محلی باید فقط رقم باشد.',
    localCodeLength:
      'کد محلی این سطح باید دقیقاً {digits} رقم باشد (صفرهای ابتدایی شمرده می‌شوند).',
    localCodeHintRoot:
      'بدون والد، حساب در سطح ۱ (ریشه) ساخته می‌شود و کد محلی همان کد کامل است.',
    fullCodePreview: 'کد کامل حساب',
    fullCodeIncomplete: 'با انتخاب والد و ورود کد محلی کامل می‌شود',
    levelPreview: 'سطح حساب',
    levelDefaultPostable: 'پیش‌فرض این سطح در پیکربندی فعال: {state}',
    chartNotReadyForAccount:
      'پیکربندی حسابداری فعال یافت نشد؛ ابتدا از بخش راه‌اندازی ساختار حساب‌ها، ساختار کدینگ و پیکربندی را فعال کنید. تا آن زمان ساخت حساب ممکن نیست.',
    levelBeyondStructure:
      'والد انتخاب‌شده در آخرین سطح ساختار کدینگ است و فرزند نمی‌پذیرد.',
    fullCode: 'کد کامل',
    localCodeLabel: 'کد محلی',
    parentLoadFailed:
      'دریافت فهرست حساب‌های والد انجام نشد؛ تا بارگذاری موفق، ساخت حساب ممکن نیست.',
    levelPostableNonLastWarning:
      'سطح {level} «قابل ثبت به‌صورت پیش‌فرض» است اما آخرین سطح نیست؛ حساب قابل ثبت نمی‌تواند فرزند بپذیرد، پس حساب‌های این سطح به‌صورت پیش‌فرض برگ ساخته می‌شوند و ساخت زیرمجموعه برای آن‌ها رد می‌شود.',
    noPostableLevelWarning:
      'هیچ سطحی «قابل ثبت به‌صورت پیش‌فرض» نیست؛ حساب‌ها با پیش‌فرض سطح، تجمیعی ساخته می‌شوند مگر هنگام ساخت هر حساب قابل‌ثبت‌بودن صریح انتخاب شود. بدون حساب برگِ قابل ثبت، ثبت سند حسابداری ممکن نیست.',
    accountTitle: 'عنوان حساب',
    parentAccount: 'حساب والد',
    rootParent: 'بدون والد (ریشه)',
    postableAccount: 'قابل ثبت (برگ)',
    postableMode: 'حالت ثبت حساب',
    postableDefault: 'پیش‌فرض پیکربندی سطح',
    postableYes: 'بله — حساب برگ قابل ثبت',
    postableNo: 'خیر — حساب تجمیعی',
    postableHint:
      'اگر «پیش‌فرض پیکربندی» بماند، سرور وضعیت ثبت را از تنظیم سطح حساب تعیین می‌کند؛ بنابراین حساب‌های تازه دیگر به‌طور ناخواسته تجمیعی ساخته نمی‌شوند.',
    creatingAccount: 'در حال ایجاد…',
    accountCreated: 'حساب ایجاد شد.',
    setupStateLoading: 'در حال دریافت وضعیت راه‌اندازی ساختار حساب‌ها…',
    setupStateFailed:
      'دریافت وضعیت فعلی ساختار حساب‌ها انجام نشد؛ تا مشخص‌شدن وضعیت سرور، هیچ اقدامی انجام نمی‌شود.',
    setupForbidden:
      'برای مشاهده یا تکمیل راه‌اندازی ساختار حساب‌ها مجوز کافی ندارید. با مدیر سامانه تماس بگیرید.',
    setupIncompatible:
      'ساختار کدینگ فعال و پیکربندی حسابداری فعال با یکدیگر سازگار نیستند (تعداد سطوح یا ارقام سطوح متفاوت است). سامانه هیچ‌کدام را خودکار تغییر نمی‌دهد؛ این ناسازگاری باید توسط مدیر حسابداری از مسیرهای تخصصی برطرف شود و تا آن زمان ساخت حساب ریشه ممکن نیست.',
    setupPartial:
      'بخشی از راه‌اندازی قبلاً انجام شده است. فقط گام‌های باقی‌مانده — بر اساس وضعیت واقعی سرور — انجام می‌شوند و هیچ ساختار تکراری ساخته نمی‌شود.',
    setupMissingPermission:
      'برای تکمیل همه گام‌های راه‌اندازی، هر دو مجوز «پیکربندی ساختار کدینگ» و «پیکربندی حسابداری» لازم است. گام‌هایی که مجوزشان را ندارید انجام نمی‌شوند.',
    setupStepDone: 'انجام شده',
    setupStepPending: 'باقی‌مانده',
    codingStructureStep: 'ساختار کدینگ',
    accountingConfigurationStep: 'پیکربندی حسابداری',
    setupRetryState: 'تلاش دوباره برای دریافت وضعیت',
    setupPartialFailure:
      'برخی گام‌ها انجام نشد. وضعیت واقعی سرور دوباره خوانده می‌شود؛ فقط گام‌های باقی‌مانده قابل تلاش دوباره‌اند.',
  },
  fiscalYear: {
    new: 'سال مالی جدید',
    edit: 'ویرایش',
    createTitle: 'ایجاد سال مالی',
    editTitle: 'ویرایش سال مالی',
    subtitle: 'اطلاعات سال مالی و پیوند آن با سال پیشین را مدیریت کنید.',
    code: 'کد',
    name: 'نام',
    title: 'نام',
    startDate: 'تاریخ شروع',
    endDate: 'تاریخ پایان',
    priorYear: 'سال مالی پیشین',
    noPriorYear: 'بدون سال مالی پیشین',
    status: 'وضعیت',
    financialArea: 'حوزه مالی',
    save: 'ذخیره',
    saving: 'در حال ذخیره…',
    created: 'سال مالی ایجاد شد.',
    updated: 'سال مالی به‌روزرسانی شد.',
    reason: 'دلیل',
    reasonRequired: 'ثبت دلیل برای این گذار الزامی است.',
    reasonTooLong: 'دلیل نباید بیش از ۵۰۰ نویسه باشد.',
    sealedEditUnavailable:
      'سال مهروموم‌شده قابل ویرایش نیست؛ ابتدا از عملیات رفع مهر استفاده کنید.',
    priorYearsLoadFailed: 'دریافت سال‌های همان حوزه مالی انجام نشد.',
    actions: 'عملیات',
    loadFailed: 'دریافت سال مالی انجام نشد. دوباره تلاش کنید.',
    saveFailed: 'ذخیره سال مالی انجام نشد. دوباره تلاش کنید.',
    transitionFailed:
      'تغییر وضعیت سال مالی انجام نشد. وضعیت را بررسی و دوباره تلاش کنید.',
    dateRange: 'تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.',
    dateFormat: 'تاریخ معتبر وارد کنید.',
    codeRequired: 'کد سال مالی الزامی است.',
    codeTooLong: 'کد سال مالی نباید بیش از ۶۴ نویسه باشد.',
    nameRequired: 'نام سال مالی الزامی است.',
    nameTooLong: 'نام سال مالی نباید بیش از ۲۰۰ نویسه باشد.',
    areaUnavailable:
      'برای ایجاد سال مالی، ابتدا حوزه مالی فعال را انتخاب کنید.',
    unavailableArea: 'حوزه مالی جاری در دسترس نیست.',
    transitions: {
      close: {
        label: 'بستن سال',
        title: 'بستن سال مالی',
        body: 'با بستن این سال مالی، همه دوره‌های باز همین سال نیز در همان تراکنش بسته می‌شوند. پس از تأیید، ثبت سند در دوره‌های بسته ممکن نیست.',
        confirm: 'بستن سال مالی',
        success: 'سال مالی و دوره‌های باز آن بسته شدند.',
      },
      reopen: {
        label: 'بازگشایی سال',
        title: 'بازگشایی سال مالی بسته‌شده',
        body: 'سال مالی بسته‌شده دوباره به وضعیت باز برمی‌گردد.',
        confirm: 'بازگشایی',
        success: 'سال مالی بازگشایی شد.',
      },
      seal: {
        label: 'مهروموم سال',
        title: 'مهروموم سال مالی',
        body: 'پس از مهروموم، هیچ سند جدیدی در این سال ثبت نمی‌شود. سامانه وجود دوره باز را نیز بررسی می‌کند.',
        confirm: 'مهروموم سال',
        success: 'سال مالی مهروموم شد.',
      },
      unseal: {
        label: 'رفع مهر',
        title: 'رفع مهر سال مالی',
        body: 'سال از حالت مهروموم‌شده خارج و به وضعیت بسته برمی‌گردد.',
        confirm: 'رفع مهر',
        success: 'مهر سال مالی برداشته شد.',
      },
    },
    errorCodes: {
      duplicateCode: 'این کد در این حوزه مالی قبلاً استفاده شده است.',
      invalidTransition:
        'این گذار با وضعیت فعلی سال مالی سازگار نیست. داده‌ها را تازه‌سازی کنید.',
      openPeriods: 'برای مهروموم سال، ابتدا همه دوره‌های باز آن را ببندید.',
      conflict:
        'وضعیت سال مالی هم‌زمان تغییر کرده است. فهرست را تازه‌سازی کنید.',
      validation: 'اطلاعات ارسالی پذیرفته نشد. فیلدها و دلیل را بررسی کنید.',
    },
  },
  // Financial-area administration (ACC-01): the management surface over
  // `FinancialAreasController`. The domain term stays «حوزه مالی» — the
  // established repository vocabulary — never a UI-invented synonym.
  financialArea: {
    title: 'حوزه‌های مالی',
    subtitle:
      'حوزه مالی، دفاتر مالی مستقل یک سازمان را مشخص می‌کند و سال‌های مالی درون آن تعریف می‌شوند.',
    new: 'حوزه مالی جدید',
    edit: 'ویرایش',
    code: 'کد',
    name: 'نام',
    actions: 'عملیات',
    defaultArea: 'حوزه پیش‌فرض',
    setDefault: 'تعیین پیش‌فرض',
    setDefaultBody:
      'با تعیین این حوزه به‌عنوان پیش‌فرض سازمان، حوزه‌ای که پیش‌تر پیش‌فرض بود دیگر پیش‌فرض نخواهد بود. در هر سازمان فقط یک حوزه پیش‌فرض وجود دارد.',
    enable: 'فعال‌سازی',
    disable: 'غیرفعال‌سازی',
    enabling: 'در حال فعال‌سازی…',
    disabling: 'در حال غیرفعال‌سازی…',
    enableBody:
      'با فعال‌سازی، این حوزه دوباره برای انتخاب در زمینه مالی و تعریف سال مالی جدید در دسترس خواهد بود.',
    disableBody:
      'با غیرفعال‌سازی، این حوزه برای انتخاب در زمینه مالی پیشنهاد نمی‌شود و تعریف سال مالی جدید در آن ممکن نخواهد بود؛ سوابق موجود همچنان قابل مشاهده می‌مانند. این عملیات حذف نیست و بعداً قابل برگشت است.',
    save: 'ذخیره',
    saving: 'در حال ذخیره…',
    saved: 'حوزه مالی ذخیره شد.',
    created: 'حوزه مالی ایجاد شد.',
    updated: 'حوزه مالی به‌روزرسانی شد.',
    enabled: 'حوزه مالی فعال شد.',
    disabled: 'حوزه مالی غیرفعال شد.',
    defaultSet: 'حوزه مالی پیش‌فرض تعیین شد.',
    createTitle: 'ایجاد حوزه مالی',
    editTitle: 'ویرایش حوزه مالی',
    codeRequired: 'کد الزامی است.',
    codeTooLong: 'کد نباید بیش از ۶۴ نویسه باشد.',
    titleRequired: 'نام الزامی است.',
    titleTooLong: 'نام نباید بیش از ۲۰۰ نویسه باشد.',
    loadFailed: 'دریافت حوزه مالی انجام نشد. دوباره تلاش کنید.',
    saveFailed: 'ذخیره حوزه مالی انجام نشد. دوباره تلاش کنید.',
    loading: 'در حال دریافت حوزه مالی…',
    dirtyLeaveTitle: 'خروج از فرم',
    dirtyLeaveDescription: 'تغییرات ذخیره‌نشده این فرم از دست می‌رود.',
    dirtyLeaveConfirm: 'خروج بدون ذخیره',
    // Mapped by the stable error CODE of the normalized envelope (never by
    // message text). The backend service raises Conflict for a duplicate
    // code and BusinessRuleViolation (with `details.openFiscalYearId`) when
    // disabling an area that still has an open fiscal year; there is no
    // `accounting.financial_area.*` code family in the backend contract.
    errorCodes: {
      duplicateCode:
        'این کد در سازمان جاری قبلاً ثبت شده است. کد دیگری بگذارید.',
      hasOpenFiscalYear:
        'این حوزه سال مالی باز دارد و غیرفعال نمی‌شود. ابتدا سال مالی باز را ببندید یا مهروموم کنید.',
      businessRule:
        'سامانه این تغییر را با قواعد کسب‌وکار سازگار ندانست. وضعیت حوزه و سال‌های مالی آن را بازبینی کنید.',
      validationSummary:
        'سامانه اطلاعات ارسالی را نپذیرفت. فیلدهای مشخص‌شده را اصلاح کنید.',
      enableFailed: 'فعال‌سازی حوزه مالی انجام نشد. دوباره تلاش کنید.',
      disableFailed: 'غیرفعال‌سازی حوزه مالی انجام نشد. دوباره تلاش کنید.',
      setDefaultFailed: 'تعیین حوزه پیش‌فرض انجام نشد. دوباره تلاش کنید.',
    },
  },
  financialContext: {
    areaResolving: 'در حال دریافت حوزه‌های مالی فعال…',
    yearResolving: 'در حال دریافت سال‌های مالی باز…',
    areaTitle: 'انتخاب حوزه مالی',
    areaBody:
      'برای ورود به فضای کاری، یک حوزه مالی فعال از سازمان جاری انتخاب کنید.',
    areaInvalidTitle: 'حوزه مالی انتخاب‌شده دیگر در دسترس نیست',
    areaInvalidBody:
      'حوزه مالی پیشین غیرفعال شده یا دسترسی آن تغییر کرده است. یک حوزه مالی فعال انتخاب کنید.',
    areaEmptyTitle: 'حوزه مالی فعالی وجود ندارد',
    areaEmptyBody:
      'برای سازمان جاری هنوز حوزه مالی فعال تعریف نشده است. هیچ حوزه‌ای به‌صورت خودکار ایجاد نمی‌شود.',
    fiscalYearTitle: 'انتخاب سال مالی',
    fiscalYearBody:
      'یک سال مالی باز و فعال در حوزه مالی انتخاب‌شده تعیین کنید.',
    fiscalYearInvalidTitle: 'سال مالی انتخاب‌شده دیگر در دسترس نیست',
    fiscalYearInvalidBody:
      'سال مالی پیشین بسته، غیرفعال یا خارج از حوزه مالی انتخاب‌شده است. یک سال مالی باز انتخاب کنید.',
    fiscalYearEmptyTitle: 'سال مالی باز و فعالی وجود ندارد',
    fiscalYearEmptyBody:
      'برای این حوزه مالی سال مالی باز و فعال تعریف نشده است. ورود به فضای کاری بدون این زمینه مجاز نیست.',
    contextForbiddenTitle: 'زمینه مالی در دسترس نیست',
    contextForbiddenBody:
      'مجوز مشاهده حوزه‌های مالی یا سال‌های مالی در دسترس شما نیست. با مدیر سامانه تماس بگیرید.',
    areaLoadFailed: 'دریافت حوزه‌های مالی انجام نشد. دوباره تلاش کنید.',
    fiscalYearLoadFailed: 'دریافت سال‌های مالی انجام نشد. دوباره تلاش کنید.',
    continue: 'ادامه',
    createAreaTitle: 'ایجاد حوزه مالی',
    createAreaBody:
      'این حوزه به سازمان جاری تعلق خواهد داشت و فقط پس از تأیید سرور قابل انتخاب است.',
    createFiscalYearTitle: 'ایجاد سال مالی',
    createFiscalYearBody:
      'این سال مالی به حوزه مالی انتخاب‌شده تعلق خواهد داشت و فقط پس از تأیید سرور قابل انتخاب است.',
    createArea: 'ایجاد حوزه مالی',
    createFiscalYear: 'ایجاد سال مالی',
    creating: 'در حال ایجاد…',
    code: 'کد',
    title: 'نام',
    startDate: 'تاریخ شروع',
    endDate: 'تاریخ پایان',
    codeRequired: 'کد الزامی است.',
    titleRequired: 'نام الزامی است.',
    startDateRequired: 'تاریخ شروع الزامی است.',
    endDateRequired: 'تاریخ پایان الزامی است.',
    dateFormat: 'تاریخ معتبر نیست.',
    dateRange: 'تاریخ پایان باید برابر یا پس از تاریخ شروع باشد.',
    areaSwitcher: 'تغییر حوزه مالی',
    fiscalYearSwitcher: 'تغییر سال مالی',
    currentArea: 'حوزه مالی جاری',
    currentFiscalYear: 'سال مالی جاری',
  },
  filters: {
    title: 'فیلترها',
    financialArea: 'حوزه مالی',
    fiscalYear: 'سال مالی',
    accountingPeriod: 'دوره مالی',
    account: 'حساب',
    accountCode: 'کد حساب',
    accountName: 'نام حساب',
    dateFrom: 'از تاریخ',
    dateTo: 'تا تاریخ',
    allPeriods: 'کل سال مالی',
    allAccounts: 'همه حساب‌ها',
    select: 'انتخاب کنید',
    submit: 'نمایش گزارش',
    reset: 'پاک کردن فیلترها',
    dateFormatHint: 'قالب تاریخ: YYYY-MM-DD (مطابق قرارداد API)',
    dateFormatHintJalali: 'قالب تاریخ: YYYY/MM/DD (تقویم هجری شمسی)',
    invalidDate: 'تاریخ معتبر نیست.',
    requiredField: 'این فیلد الزامی است.',
    postableOnly: 'فقط حساب‌های قابل ثبت (برگ) قابل انتخاب هستند.',
    referencesLoading: 'در حال دریافت اطلاعات پایه…',
    missingScope: 'برای نمایش گزارش، حوزه مالی و سال مالی را انتخاب کنید.',
    missingStatementScope: 'برای نمایش گزارش، حساب و سال مالی را انتخاب کنید.',
    allWarehouses: 'همه انبارها',
    allItems: 'همه کالاها',
  },
  table: {
    loading: 'در حال دریافت داده‌ها…',
    refreshing: 'در حال به‌روزرسانی…',
    emptyTitle: 'داده‌ای یافت نشد',
    emptyBody: 'برای فیلترهای انتخاب‌شده هیچ ردیفی بازگردانده نشد.',
    errorTitle: 'خطا در دریافت داده‌ها',
    rowsTotal: 'تعداد ردیف‌ها',
    page: 'صفحه',
    of: 'از',
    previous: 'قبلی',
    next: 'بعدی',
    pageSize: 'تعداد در صفحه',
    sortAsc: 'صعودی',
    sortDesc: 'نزولی',
    selectAll: 'انتخاب همه ردیف‌های این صفحه',
    selectRow: 'انتخاب ردیف',
    selectedCount: '{count} ردیف انتخاب‌شده',
    clearSelection: 'لغو انتخاب',
    // Light client-side filtering (`docs/frontend/data-table.md`).
    filters: {
      searchLabel: 'جست‌وجوی سراسری',
      searchPlaceholder: 'جست‌وجو در همه ستون‌ها…',
      columnFilterLabel: 'فیلتر ستون',
      textPlaceholder: 'شامل می‌شود…',
      allOption: 'همه',
      from: 'از',
      to: 'تا',
      min: 'حداقل',
      max: 'حداکثر',
      numberPlaceholder: 'مثلاً 1000',
      multiSelect: '{count} انتخاب',
      multiSelectEmpty: 'انتخاب مقادیر',
      reset: 'پاک کردن فیلترها',
      activeCount: '{count} فیلتر فعال',
      noMatchTitle: 'نتیجه‌ای یافت نشد',
      noMatchBody:
        'هیچ ردیفی با جست‌وجو یا فیلترهای فعلی مطابقت ندارد. فیلترها را پاک کنید یا عبارت دیگری بنویسید.',
      clearFilters: 'پاک کردن جست‌وجو و فیلترها',
      resultSummary: 'نمایش {filtered} از {total} ردیف',
      truncatedNotice:
        'فیلترها روی {count} ردیف بارگذاری‌شده اعمال می‌شوند؛ برای دیدن بقیه، فیلتر سمت سرور را به کار ببرید.',
    },
  },
  chartTree: {
    title: 'درخت حساب‌ها',
    subtitle: 'ساختار حساب‌های سازمان (فقط خواندنی).',
    expandAll: 'باز کردن همه',
    collapseAll: 'بستن همه',
    postable: 'قابل ثبت',
    aggregation: 'تجمیعی',
    inactive: 'غیرفعال',
    level: 'سطح',
    nature: 'ماهیت',
    natureDebit: 'بدهکار',
    natureCredit: 'بستانکار',
    natureDual: 'دوگانه',
    nodesLoaded: 'حساب بارگذاری‌شده',
    truncatedNotice:
      'به دلیل حجم زیاد، همه حساب‌ها بارگذاری نشدند؛ صفحه‌های بعدی در این نما نمایش داده نمی‌شوند.',
    emptyTitle: 'حسابی ثبت نشده است',
    emptyBody: 'برای این سازمان هیچ حسابی در درخت حساب‌ها وجود ندارد.',
  },
  statement: {
    title: 'گردش حساب',
    subtitle: 'گردش یک حساب در یک سال مالی (و در صورت انتخاب، یک دوره مالی).',
    openingBalance: 'مانده ابتدای دوره',
    debitTotal: 'جمع بدهکار',
    creditTotal: 'جمع بستانکار',
    netChange: 'خالص گردش',
    closingBalance: 'مانده پایانی',
    signConvention: 'قرارداد علامت',
    openingBasis: 'مبنای مانده ابتدای دوره',
    orderBasis: 'ترتیب ردیف‌ها',
    scope: 'دامنه گزارش',
    documentDate: 'تاریخ سند',
    postingTimestamp: 'زمان ثبت',
    voucherNumber: 'شماره سند',
    lineNo: 'ردیف',
    description: 'شرح',
    debit: 'بدهکار',
    credit: 'بستانکار',
    net: 'خالص',
    runningBalance: 'مانده تجمعی',
    origin: 'منشأ',
  },
  generalLedger: {
    title: 'دفتر کل',
    subtitle: 'ردیف‌های ثبت‌شده دفتر کل (فقط خواندنی).',
    documentDate: 'تاریخ سند',
    documentType: 'نوع سند',
    voucherNumber: 'شماره سند',
    lineNo: 'ردیف',
    accountCode: 'کد حساب',
    accountName: 'نام حساب',
    description: 'شرح',
    debit: 'بدهکار',
    credit: 'بستانکار',
    net: 'خالص',
    postingTimestamp: 'زمان ثبت',
    origin: 'منشأ',
  },
  trialBalance: {
    title: 'تراز آزمایشی',
    subtitle: 'تراز آزمایشی حساب‌ها بر اساس دامنه انتخاب‌شده (فقط خواندنی).',
    accountCode: 'کد حساب',
    accountName: 'نام حساب',
    role: 'نوع حساب',
    rolePosting: 'قابل ثبت',
    roleAggregation: 'تجمیعی',
    opening: 'مانده ابتدای دوره',
    debitTurnover: 'گردش بدهکار',
    creditTurnover: 'گردش بستانکار',
    periodNet: 'خالص دوره',
    closing: 'مانده پایانی',
  },
  errors: {
    title: 'خطا',
    network: 'ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.',
    unauthorized: 'برای ادامه باید وارد شوید.',
    forbidden: 'مجوز لازم برای این عملیات را ندارید.',
    notFound: 'مورد درخواست‌شده یافت نشد یا در دامنه دسترسی شما نیست.',
    validation: 'اطلاعات ارسالی معتبر نیست.',
    businessRule: 'این درخواست با قواعد کسب‌وکار سازگار نیست.',
    conflict: 'تداخل در داده‌ها رخ داد.',
    rateLimited: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.',
    server: 'خطای غیرمنتظره در سرور رخ داد.',
    unknown: 'خطای ناشناخته رخ داد.',
    correlationId: 'کد پیگیری',
  },
  dashboardErrors: {
    kpi: 'محاسبه شاخص‌ها انجام نشد. برای دیدن شاخص‌ها ابتدا حوزه مالی و سال مالی را انتخاب کنید.',
    documents:
      'دریافت فهرست اسناد انجام نشد. فیلترها را بررسی کنید یا دوباره تلاش کنید.',
    inventory:
      'دریافت موجودی انبار انجام نشد. دوباره تلاش کنید یا با مدیر سامانه تماس بگیرید.',
    periods:
      'دریافت دوره‌های مالی انجام نشد. دوباره تلاش کنید یا با مدیر سامانه تماس بگیرید.',
    workflow: 'دریافت گردش‌کارهای فعال انجام نشد. دوباره تلاش کنید.',
    charts:
      'رسم نمودارها انجام نشد. دوباره تلاش کنید یا با مدیر سامانه تماس بگیرید.',
    scopeMissing:
      'برای نمایش شاخص‌های مالی، حوزه مالی و سال مالی را انتخاب کنید.',
    forbiddenSection:
      'مجوز لازم برای این بخش را ندارید؛ نمایش آن تا دریافت مجوز پنهان می‌شود.',
  },
  workspace: {
    quickAccessTitle: 'دسترسی سریع حوزه‌های کاری',
    quickAccessSubtitle: 'ورود مستقیم به فرم‌ها و گزارش‌های مجاز نشست شما',
    accountingReportsGroup: 'گزارش‌های حسابداری',
    accountingOperationsGroup: 'اسناد و عملیات حسابداری',
    inventoryOperationsGroup: 'عملیات و اسناد انبار',
    inventoryMasterGroup: 'اطلاعات پایه انبار',
    organizationGroup: 'سازمان و اطلاعات پایه',
    adminGroup: 'مدیریت سامانه و مجوز',
  },
  profile: {
    title: 'پروفایل کاربری و تنظیمات',
    subtitle: 'مشخصات حساب کاربری جاری، تغییر گذرواژه و تنظیمات نمایش سامانه.',
    accountSection: 'مشخصات حساب کاربری',
    usernameLabel: 'نام کاربری',
    userIdLabel: 'شناسه کاربر',
    statusLabel: 'وضعیت حساب',
    activeOrganizationLabel: 'سازمان فعال جاری',
    saveUsername: 'ذخیره نام کاربری',
    savingUsername: 'در حال ذخیره نام کاربری…',
    usernameUpdated: 'نام کاربری با موفقیت به‌روزرسانی شد.',
    usernameReadOnlyHint:
      'ویرایش نام کاربری نیازمند مجوز «Users.User.Edit» است.',
    avatarBackendNote:
      'تصویر پروفایل و فیلدهای تکمیلی فردی هنوز در قرارداد بک‌اند (Users/Identity) تعریف نشده‌اند؛ فقط فیلدهای واقعی متصل به سرور نمایش داده می‌شوند.',
    passwordSection: 'تغییر گذرواژه حساب',
    passwordSectionSubtitle:
      'پس از تغییر گذرواژه، نشست فعلی شما فعال می‌ماند و سایر نشست‌های فعال این حساب باطل می‌شوند.',
    passwordChangedSuccess: 'گذرواژه حساب کاربری شما با موفقیت تغییر کرد.',
    appearanceSection: 'تنظیمات نرم‌افزار و نمایش',
    appearanceSubtitle:
      'انتخاب پوسته روشن/تیره و اندازه نوشته در این مرورگر ذخیره می‌شود.',
    sessionSection: 'نشست کاربری',
    sessionSubtitle:
      'برای پایان دادن امن به نشست فعلی در سرور از دکمه زیر استفاده کنید.',
  },
  datePicker: {
    openCalendar: 'انتخاب تاریخ از تقویم شمسی',
    closeCalendar: 'بستن تقویم',
    dialogLabel: 'تقویم هجری شمسی',
    prevMonth: 'ماه قبل',
    nextMonth: 'ماه بعد',
    prevYear: 'سال قبل',
    nextYear: 'سال بعد',
    today: 'امروز',
    clear: 'پاک کردن',
    months: [
      'فروردین',
      'اردیبهشت',
      'خرداد',
      'تیر',
      'مرداد',
      'شهریور',
      'مهر',
      'آبان',
      'آذر',
      'دی',
      'بهمن',
      'اسفند',
    ] as const,
    weekdaysShort: ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const,
  },
  operationalForm: {
    toolbarLabel: 'نوار ابزار عملیاتی',
    print: 'چاپ',
    exportExcel: 'خروجی اکسل',
    toggleFilters: 'فیلترها',
    openSelected: 'باز کردن سند انتخابی',
    viewDocumentLines: 'فهرست ردیف‌های اسناد',
    viewDocuments: 'فهرست اسناد',
    collapseHeader: 'جمع کردن سربرگ',
    expandHeader: 'باز کردن سربرگ',
    headerIncompleteHint:
      'تا تکمیل فیلدهای الزامی سربرگ، امکان جمع کردن سربرگ وجود ندارد.',
    headerCollapsedSummaryLabel: 'خلاصه سربرگ سند',
    rowNumber: 'ردیف',
    rowActions: 'عملیات ردیف',
    insertRowAbove: 'درج ردیف در بالا',
    insertRowBelow: 'درج ردیف در پایین',
    duplicateRow: 'کپی ردیف',
    deleteRow: 'حذف ردیف',
    addRow: 'افزودن ردیف',
    emptyRows: 'ردیفی ثبت نشده است.',
    virtualizedHint:
      'حالت نمایش بهینه برای تعداد زیاد ردیف فعال است ({visible} از {total} ردیف).',
    summaryLabel: 'خلاصه محاسباتی سند',
    balanceStatus: 'وضعیت تراز',
    balanced: 'متوازن',
    unbalancedDiff: 'اختلاف: {diff}',
    lineCount: 'تعداد ردیف‌ها',
    totalQuantity: 'جمع مقدارها',
    serverAuthorityHint:
      'محاسبات خلاصه صرفاً جهت راهنمای ورود داده است؛ اعتبارسنجی و ثبت نهایی بر عهده سرور است.',
    footerLabel: 'نوار عملیات پایانی سند',
    newDocument: 'سند جدید',
    prevDocument: 'سند قبلی',
    nextDocument: 'سند بعدی',
    documentPosition: 'سند {current} از {total}',
    confirmSave: 'تأیید و ذخیره',
    unsavedNavigationTitle: 'جابه‌جایی با تغییرات ذخیره‌نشده',
    unsavedNavigationBody:
      'تغییرات فعلی ذخیره نشده‌اند. در صورت جابه‌جایی به سند دیگر، تغییرات از دست می‌رود.',
    unsavedNavigationConfirm: 'ادامه بدون ذخیره',
  },
  documentLines: {
    accountingTitle: 'فهرست ردیف‌های اسناد حسابداری',
    accountingSubtitle:
      'نمای تجمیعی و فقط‌خواندنی ردیف‌های اسناد حسابداری سازمان به‌همراه اطلاعات سربرگ سند مرتبط.',
    inventoryTitle: 'فهرست ردیف‌های اسناد انبار',
    inventorySubtitle:
      'نمای تجمیعی و فقط‌خواندنی ردیف‌های اسناد عملیاتی انبار به‌همراه مشخصات سند مرتبط.',
    openParentDocument: 'باز کردن سند',
    searchLinesPlaceholder: 'جست‌وجو در شماره سند، شرح یا کد…',
    colDocNumber: 'شماره سند',
    colDocDate: 'تاریخ سند',
    colDocState: 'وضعیت سند',
    colDocKind: 'نوع سند',
    colHeaderDescription: 'شرح سند',
    colLineNo: 'ردیف',
    colAccount: 'حساب',
    colDetail: 'تفصیلی',
    colLineDescription: 'شرح ردیف',
    colDebit: 'بدهکار',
    colCredit: 'بستانکار',
    colWarehouse: 'انبار',
    colItem: 'کالا',
    colQuantity: 'مقدار',
    colUnit: 'واحد',
    colBaseQuantity: 'مقدار مبنا',
    emptyAccountingTitle: 'ردیفی از اسناد حسابداری یافت نشد',
    emptyAccountingBody:
      'برای فیلترهای انتخاب‌شده یا در سازمان جاری هنوز ردیف سند حسابداری وجود ندارد.',
    emptyInventoryTitle: 'ردیفی از اسناد انبار یافت نشد',
    emptyInventoryBody:
      'برای فیلترهای انتخاب‌شده یا در سازمان جاری هنوز ردیف سند انباری وجود ندارد.',
  },
} as const;

/** The single dictionary the application reads (language decision: OQ-02). */
export const t = fa;
