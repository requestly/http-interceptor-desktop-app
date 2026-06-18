export interface UserPreferenceObj {
  defaultPort: number;
  allowInsecureCerts?: boolean;
  localFileLogConfig: {
    isEnabled: boolean;
    storePath: string;
    filter: string[]
  };
}

export interface ISource {
  defaultPort: number;
  allowInsecureCerts?: boolean;
  isLocalLoggingEnabled: boolean;
  logStorePath: string;
  localLogFilterfilter: string[]
}
