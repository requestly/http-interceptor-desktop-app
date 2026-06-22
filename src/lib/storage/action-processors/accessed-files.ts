import path from "path";
import { ACCESSED_FILES } from "../types/action-types";
import { StorageAction } from "../types/storage-action";
import BaseActionProcessor from "./base";

type AccessedFileCategoryTag = "web-session" | "har" | "unknown";

export interface AccessedFile {
  filePath: string;
  category: AccessedFileCategoryTag;
  name: string;
  lastAccessedTs: number;
  id: string;
}

// not to be done in this class process
export default class AccessedFilesProcessor extends BaseActionProcessor {
  process = ({ type, payload }: StorageAction) => {
    let category;
    let filePath: string;
    let name: string;
    let lastAccessedTs: number;
    if (type === ACCESSED_FILES.GET_CATEGORY) {
      console.log("get category", payload);
      // @ts-ignore // todo; remove this ignore
      category = payload?.data?.category as unknown as AccessedFileCategoryTag;
      const accessedFilesFromeStore = this.store.get(category) as Record<
        AccessedFile["filePath"],
        AccessedFile
      >;

      console.log("accessedFilesFromeStore", accessedFilesFromeStore )
      return Object.values(accessedFilesFromeStore).sort(
        (a, b) => b.lastAccessedTs - a.lastAccessedTs
      );
    }

    if (type === ACCESSED_FILES.ADD) {
      const file = payload?.data as AccessedFile;
      category = file.category;
      filePath = file.filePath;
      name = file.name;
      lastAccessedTs = file.lastAccessedTs;

      const accessedFilesRecords = (this.store.get(category) as any) || {};
      accessedFilesRecords[filePath] = {
        filePath,
        name,
        lastAccessedTs,
        category,
        id: filePath,
      };
      this.store.set({ [category]: accessedFilesRecords });
    } else if (type === ACCESSED_FILES.REMOVE) {
      const getFileCategory = (fileExtension: string) =>  {
        switch(fileExtension) {
          case ".har":
            return "har";
          case ".rqly":
            // in future we can also store rules here...
            return "web-session";
          default:
            return "unknown";
        }
      }
      // @ts-ignore
      filePath = payload?.data as string;
      const extension = path.extname(filePath);
      category = getFileCategory(extension) as AccessedFileCategoryTag;
      const accessedFilesRecords = this.store.get(category);
      delete accessedFilesRecords[filePath];
      this.store.set({ [category]: accessedFilesRecords });
    } else {
      console.log("unexpected accessed file action", type, payload);
    }
    return null;
  };
}
