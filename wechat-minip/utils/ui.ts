import { Const, Env, dictValues, monitorObject, throttle } from './index';
import * as Storage from './storage';
import { App } from '../app';

export class UISetting {
  public DeviceSetting = monitorObject<MP.UI.DeviceSetting>(
    Const.DefaultUIDeviceSetting,
    this.onDeviceSettingUpdate.bind(this),
  );
  public InternalSetting = monitorObject<MP.UI.InternalSetting>(
    Const.UIInternalSetting,
    this.onInternalSettingUpdate.bind(this),
  );
  public UserSetting = monitorObject<MP.UI.UserSetting>(
    Const.DefaultUIUserSetting,
    this.onUserSettingUpdate.bind(this),
  );

  public App: (App.AppInstance<App> & App) | null = null;
  public Env: Env = new Env(Const.DefaultSystemInfo);
  public SystemInfo: GlobalSystemInfo = { ...Const.DefaultSystemInfo };
  public PageData = {
    ...this.applyDeviceSetting(),
    ...this.applyUserSetting(),
  };

  private loadBatteryInfoTask?: ReturnType<typeof setTimeout>;

  constructor() {
    this.loadCache().catch(() => {});
    (this.loadIconfont = this.loadIconfont.bind(this))();
    (this.loadBatteryInfo = this.loadBatteryInfo.bind(this))();
  }

  public forceUpdateUserSetting() {
    this.onUserSettingUpdate(this.UserSetting);
  }

  public loadBatteryInfo() {
    if (this.loadBatteryInfoTask === undefined)
      this.loadBatteryInfoTask = setTimeout(this.loadBatteryInfo, 30000);
    wx.getBatteryInfo({
      success: battery => {
        const prev = this.isAnimationEnabled();
        this.SystemInfo.battery = battery;
        const next = this.isAnimationEnabled();
        if (next !== prev) this.forceUpdateUserSetting();
      },
      complete: () => (this.loadBatteryInfoTask = undefined),
    });
  }

  public loadIconfont(wait: number = 0) {
    const { IconfontUrl } = this.InternalSetting;
    if (!IconfontUrl) return;
    if (wait) setTimeout(this.loadIconfont, wait);
    else wx.loadFontFace({ family: 'iconfont', source: `url("${IconfontUrl}")` });
  }

  public loadSystemInfo() {
    return new Promise<boolean>(resolve => {
      wx.getSystemInfo({
        fail: () => resolve(false),
        success: next => resolve(this.updateSystemInfo(next)),
      });
    });
  }

  public maxSplits(height: number, times: number = 1) {
    return Math.ceil((times * this.DeviceSetting.screenHeight) / height);
  }

  public nodeScrollsOverNavbar(offset: number, scrollTop: number) {
    return offset - this.DeviceSetting.sysNavtop < scrollTop;
  }

  public onDeviceSettingUpdate(value: MP.UI.DeviceSetting) {
    Object.assign(this.PageData, this.applyDeviceSetting(value));
    this.App?.pagesMutant.update({ '_.ui': { ...this.PageData } }).commit();
    this.saveCache();
  }

  public onInternalSettingUpdate() {
    return this.updateNativeContainerStyle();
  }

  public onUserSettingUpdate(value: MP.UI.UserSetting) {
    this.updateNativeContainerStyle();
    Object.assign(this.PageData, this.applyUserSetting(value));
    this.App?.pagesMutant.update({ '_.ui': { ...this.PageData } }).commit();
    this.saveCache();
  }

  public updateNativeContainerStyle(
    nextUserSetting?: Partial<MP.UI.UserSetting>,
    nextInternalSetting?: Partial<MP.UI.InternalSetting>,
  ) {
    const { NativeContainerBGColor: BGColor, NativeContainerBGText: BGText } = {
      ...this.InternalSetting,
      ...nextInternalSetting,
    };
    const isDarkMode = this.isDarkMode(nextUserSetting);
    const modeKey: MP.UI.ThemeMode = isDarkMode ? 'dark' : 'light';
    if (BGColor)
      wx.setBackgroundColor({
        backgroundColor: typeof BGColor === 'string' ? BGColor : BGColor[modeKey],
      });
    if (BGText)
      wx.setBackgroundTextStyle({
        textStyle: typeof BGText === 'string' ? BGText : BGText[modeKey],
      });
    wx.setNavigationBarColor({
      animation: { duration: 480 },
      frontColor: isDarkMode ? '#ffffff' : '#000000',
      backgroundColor: isDarkMode ? '#000000' : '#ffffff',
    });
  }

  private applyDeviceSetting(
    DeviceSetting: MP.UI.DeviceSetting = this.DeviceSetting,
    px: Record<string, boolean> = Const.DefaultPxCssvar,
  ) {
    const cssvar = (Object.keys(DeviceSetting) as (keyof MP.UI.DeviceSetting)[])
      .filter(key => DeviceSetting[key] !== undefined)
      .map(key => `--${key}: ${DeviceSetting[key]}${px[key] ? 'px' : ''};`)
      .join('');
    return { cssvar, ...DeviceSetting };
  }

  private applyUserSetting(UserSetting: MP.UI.UserSetting = this.UserSetting) {
    const dark = this.isDarkMode();
    const ios = UserSetting.os === 'ios';
    const animation = this.isAnimationEnabled();
    const wrapcls = dictValues({
      ...UserSetting,
      mode: dark ? 'dark' : 'light',
      animation: animation ? '' : 'without-animation',
    }).join(' ');
    return { animation, dark, ios, wrapcls };
  }

  private loadCache() {
    return new Promise(resolve =>
      wx.getStorage({
        fail: () => this.initCache(),
        key: Storage.Key.UIExternalSetting,
        success: ({ data: cache }) => {
          if (!cache) return resolve(this.initCache());
          this.UserSetting.update(cache as any);
          this.DeviceSetting.update(cache as any);
          return resolve(this.loadSystemInfo());
        },
      }),
    );
  }

  private initCache(): Promise<void> {
    return this.loadSystemInfo()
      .then<Partial<MP.UI.UserSetting>>(() =>
        this.Env.iOS()
          ? { os: 'ios', uilang: 'hig', animation: 'auto' }
          : { os: 'android', uilang: 'material', animation: false },
      )
      .then(this.UserSetting.update)
      .then(this.saveCache);
  }

  private saveCache = throttle(
    () =>
      wx.setStorage({
        key: Storage.Key.UIExternalSetting,
        data: { ...this.DeviceSetting, ...this.UserSetting },
      }),
    1000,
  );

  private updateSystemInfo(nextSystemInfo: wx.GetSystemInfoSuccessCallbackResult): boolean {
    this.SystemInfo = Object.assign(this.SystemInfo, {
      ...nextSystemInfo,
      wechatMenu: {
        ...Const.DefaultSystemInfo.wechatMenu,
        ...wx.getMenuButtonBoundingClientRect(),
      },
    });
    this.Env = new Env(this.SystemInfo);
    const { statusBarHeight: statusBar, wechatMenu } = this.SystemInfo;
    const sysNavbar = (wechatMenu.top - statusBar) * 2 + wechatMenu.height;
    return this.DeviceSetting.update({
      screenHeight: this.SystemInfo.screenHeight,
      screenWidth: this.SystemInfo.screenWidth,
      statusBar,
      sysNavbar,
      sysNavtop: sysNavbar + statusBar,
    });
  }

  private isAnimationEnabled({ animation }: Partial<MP.UI.UserSetting> = this.UserSetting) {
    if (typeof animation === 'boolean') return animation;
    if (!this.SystemInfo.battery) return true;
    if (this.SystemInfo.battery.isCharging) return true;
    return parseInt(this.SystemInfo.battery.level) > 20;
  }

  private isDarkMode(UserSetting: Partial<MP.UI.UserSetting> = this.UserSetting) {
    if (UserSetting.mode === 'light') return false;
    if (UserSetting.mode === 'dark') return true;
    const hours = new Date().getHours();
    return hours >= 18 || hours <= 6;
  }
}
