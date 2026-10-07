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
  },
  toasts: {
    regionLabel: 'اعلان‌ها',
    dismiss: 'بستن اعلان',
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
    inactiveBody:
      'مجوز این استقرار وردنا فعال نیست؛ تا زمان فعال‌شدن مجوز، بخش‌های کاری در دسترس نیستند. این وضعیت به سطح دسترسی حساب کاربری شما مربوط نمی‌شود؛ برای فعال‌سازی با مدیر سامانه تماس بگیرید.',
    errorTitle: 'خطا در دریافت وضعیت مجوز',
    unlicensedTitle: 'این استقرار هنوز مجوزی ندارد',
    unlicensedBody:
      'برای این استقرار وردنا هیچ مجوزی فعال نشده است. مدیر سامانه باید با شناسهٔ استقرار زیر مجوز دریافت و آن را فعال کند. این وضعیت به سطح دسترسی حساب کاربری شما مربوط نیست.',
    installationIdLabel: 'شناسهٔ استقرار',
    // فعال‌سازی مجوز نصب (L-02). متن‌ها به‌عمد از متن «دسترسی» جدا هستند.
    activateTitle: 'فعال‌سازی مجوز نصب',
    activateBody:
      'برای ادامه استفاده از وردنا، ابتدا مجوز این نصب را فعال کنید. کد مجوز را که برای شناسهٔ استقرار زیر صادر شده است وارد کنید.',
    activateCodeLabel: 'کد مجوز',
    activateCodeHint:
      'کد مجوز فقط برای ارسال به سرور استفاده می‌شود و در مرورگر ذخیره نمی‌شود.',
    activateCodeRequired: 'کد مجوز الزامی است.',
    activateCodeTooLong: 'کد مجوز واردشده بیش از اندازهٔ مجاز است.',
    activateSubmit: 'فعال‌سازی مجوز',
    activateSubmitting: 'در حال فعال‌سازی مجوز…',
    activateSuccess: 'مجوز این نصب فعال شد.',
    activateUnchanged: 'این مجوز از پیش برای این نصب فعال بود.',
    activateRejected:
      'کد مجوز پذیرفته نشد. کد را بررسی کنید و کد معتبر این نصب را وارد کنید.',
    activateInvalid: 'کد مجوز واردشده معتبر نیست. مقدار واردشده را بررسی کنید.',
    activateForbidden:
      'مجوز لازم برای فعال‌سازی مجوز نصب را ندارید. با مدیر سامانه تماس بگیرید.',
    activateFailed: 'فعال‌سازی مجوز انجام نشد. دوباره تلاش کنید.',
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
      'مدیریت عضویت کاربران سازمان، درون‌ریزی گروهی، خروجی اکسل، تاریخچه تغییرات و نمودار ساختار سازمانی در این نسخه ارائه نشده‌اند.',
  },
  breadcrumb: {
    label: 'مسیر صفحه',
  },
  nav: {
    dashboard: 'میزکار',
    accounting: 'حسابداری',
    documents: 'اسناد حسابداری',
    chartTree: 'درخت حساب‌ها',
    accountStatements: 'گردش حساب',
    generalLedger: 'دفتر کل',
    trialBalance: 'تراز آزمایشی',
    inventory: 'انبار',
    inventoryDocuments: 'اسناد انبار',
    inventoryMovements: 'گردش‌های انبار',
    inventoryKardex: 'کاردکس',
    inventoryValuation: 'ارزش‌گذاری موجودی',
    openMenu: 'باز کردن منو',
    closeMenu: 'بستن منو',
    mainMenu: 'منوی اصلی',
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
      dateInvalid:
        'تاریخ سند معتبر نیست. تاریخ را با قالب YYYY-MM-DD وارد کنید.',
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
    },
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
    dateHint: 'قالب تاریخ: YYYY-MM-DD',
    codeRequired: 'کد الزامی است.',
    titleRequired: 'نام الزامی است.',
    startDateRequired: 'تاریخ شروع الزامی است.',
    endDateRequired: 'تاریخ پایان الزامی است.',
    dateFormat: 'تاریخ باید به قالب YYYY-MM-DD باشد.',
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
    invalidDate: 'تاریخ باید به قالب YYYY-MM-DD باشد.',
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
} as const;

/** The single dictionary the application reads (language decision: OQ-02). */
export const t = fa;
