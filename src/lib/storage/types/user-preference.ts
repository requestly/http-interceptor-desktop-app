export interface UserPreferenceObj {
  defaultPort: number;
  allowInsecureCerts?: boolean;
  devScriptMode?: boolean;
  localFileLogConfig: {
    isEnabled: boolean;
    storePath: string;
    filter: string[]
  };
}

export interface ISource {
  defaultPort: number;
  allowInsecureCerts?: boolean;
  devScriptMode?: boolean;
  isLocalLoggingEnabled: boolean;
  logStorePath: string;
  localLogFilterfilter: string[]
}
