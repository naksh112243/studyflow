"use client";

import * as React from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useEngineStore } from "@/store/engine-store";
import { serializeExport, validateAndParseImport } from "@/lib/engine/export-import";
import { StudyFlowSnapshot } from "@/storage/types";
import { isTauri } from "@/storage/indexed-db";
import { ConfirmationDialog } from "@/components/ui/dialog";
import { 
  Download, 
  Upload, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  FileJson, 
  X, 
  FileCheck,
  AlertTriangle,
  Database,
  Trash2,
  History,
  Calendar,
  Plus
} from "lucide-react";

interface TransferSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type SheetState = "idle" | "preview" | "loading" | "success" | "error";

export function TransferSheet({ isOpen, onClose }: TransferSheetProps) {
  const { 
    timetables, 
    activeTimetableId, 
    importWorkspace, 
    refreshTodaySchedule,
    backups,
    loadBackups,
    createLocalBackup,
    restoreLocalBackup,
    deleteLocalBackup
  } = useEngineStore();

  const [sheetState, setSheetState] = React.useState<SheetState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string>("");
  const [isDragging, setIsDragging] = React.useState<boolean>(false);
  
  // Backup / tab details
  const [activeTab, setActiveTab] = React.useState<"backups" | "transfer">("backups");
  const [backupLabel, setBackupLabel] = React.useState<string>("");
  const [pendingRestoreId, setPendingRestoreId] = React.useState<string | null>(null);
  const [deleteBackupId, setDeleteBackupId] = React.useState<string | null>(null);

  // Preview details
  const [previewSnapshot, setPreviewSnapshot] = React.useState<StudyFlowSnapshot | null>(null);
  const [previewMetadata, setPreviewMetadata] = React.useState<{
    appVersion: string;
    exportTimestamp: string;
    timetableCount: number;
    timetableNames: string[];
  } | null>(null);

  // Load backups when sheet is opened
  React.useEffect(() => {
    if (isOpen) {
      void loadBackups();
    }
  }, [isOpen, loadBackups]);

  // Reset state on close
  React.useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setSheetState("idle");
        setErrorMessage("");
        setPreviewSnapshot(null);
        setPreviewMetadata(null);
        setIsDragging(false);
        setActiveTab("backups");
        setBackupLabel("");
        setPendingRestoreId(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleExport = async () => {
    try {
      const snapshot: StudyFlowSnapshot = {
        id: "default",
        activeTimetableId,
        timetables,
        updatedAt: new Date().toISOString(),
      };

      const serialized = serializeExport(snapshot);

      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const defaultFilename = `studyflow_export_${timestamp}.json`;
        
        const selectedPath = await save({
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: defaultFilename
        });

        if (selectedPath) {
          setSheetState("loading");
          await writeTextFile(selectedPath, serialized);
          setSheetState("success");
        }
        return;
      }
      
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = url;
      link.download = `studyflow_export_${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to generate export file.");
      setSheetState("error");
    }
  };

  const handleNativeImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");

      const selectedPath = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });

      if (selectedPath) {
        setSheetState("loading");
        const contents = await readTextFile(selectedPath as string);
        const result = validateAndParseImport(contents);
        if (!result.success) {
          setErrorMessage(result.error);
          setSheetState("error");
          return;
        }

        const { snapshot, metadata } = result;
        setPreviewSnapshot(snapshot);
        setPreviewMetadata({
          appVersion: metadata.appVersion,
          exportTimestamp: metadata.exportTimestamp,
          timetableCount: snapshot.timetables.length,
          timetableNames: snapshot.timetables.map(t => t.name),
        });
        setSheetState("preview");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to open and read file.");
      setSheetState("error");
    }
  };

  const processFile = (file: File) => {
    if (!file) return;

    if (file.type !== "application/json" && !file.name.endsWith(".json")) {
      setErrorMessage("Please select a valid JSON export file (.json).");
      setSheetState("error");
      return;
    }

    setSheetState("loading");
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result;
      if (typeof contents !== "string") {
        setErrorMessage("Could not read file contents.");
        setSheetState("error");
        return;
      }

      const result = validateAndParseImport(contents);
      if (!result.success) {
        setErrorMessage(result.error);
        setSheetState("error");
        return;
      }

      const { snapshot, metadata } = result;
      setPreviewSnapshot(snapshot);
      setPreviewMetadata({
        appVersion: metadata.appVersion,
        exportTimestamp: metadata.exportTimestamp,
        timetableCount: snapshot.timetables.length,
        timetableNames: snapshot.timetables.map(t => t.name),
      });
      setSheetState("preview");
    };

    reader.onerror = () => {
      setErrorMessage("An error occurred while reading the file.");
      setSheetState("error");
    };

    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewSnapshot) return;

    setSheetState("loading");
    try {
      await importWorkspace(previewSnapshot);
      await refreshTodaySchedule();
      setSheetState("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to import workspace.");
      setSheetState("error");
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="p-6 space-y-6 max-h-[85vh] overflow-y-auto" id="transfer-sheet-container">
        
        {/* Header */}
        <div className="flex justify-between items-start gap-4 pb-1">
          <div className="space-y-1">
            <h3 className="text-xl font-semibold tracking-tight">Data & Backups</h3>
            <p className="text-sm text-muted-foreground">
              Manage local manual backups or export/import workspace configurations offline.
            </p>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground shrink-0"
            onClick={onClose}
            aria-label="Close sheet"
            id="btn-close-transfer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* State: IDLE */}
        {sheetState === "idle" && (
          <div className="space-y-6">
            
            {/* Tab Selection */}
            <div className="flex bg-secondary/40 p-1 rounded-xl border border-border/80 mx-0.5">
              <button
                type="button"
                onClick={() => {
                  setPendingRestoreId(null);
                  setActiveTab("backups");
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === "backups"
                    ? "bg-background text-foreground shadow-sm border border-border/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                id="tab-backups-btn"
              >
                <Database className="h-3.5 w-3.5" />
                Local Backups
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingRestoreId(null);
                  setActiveTab("transfer");
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === "transfer"
                    ? "bg-background text-foreground shadow-sm border border-border/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                id="tab-transfer-btn"
              >
                <FileJson className="h-3.5 w-3.5" />
                JSON File Transfer
              </button>
            </div>

            {activeTab === "backups" && (
              <div className="space-y-6">
                {/* Pending Restore Warning Card Inline */}
                {pendingRestoreId && (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl p-5 space-y-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                      <div className="space-y-1.5">
                        <h5 className="font-bold text-sm leading-none">Confirm Workspace Restore</h5>
                        <p className="text-xs leading-normal opacity-90">
                          Restoring this backup will **completely overwrite** your current timetable layouts, subject configurations, routines, and historical statistics. This action is irreversible.
                        </p>
                        <p className="text-xs font-mono font-semibold truncate bg-destructive/5 p-2 rounded-lg border border-destructive/10">
                          Target: &quot;{backups.find(b => b.id === pendingRestoreId)?.name}&quot;
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex justify-end gap-3 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingRestoreId(null)}
                        className="h-9 px-4 rounded-xl text-xs bg-background hover:bg-secondary text-foreground"
                        id="btn-cancel-restore"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={async () => {
                          const rid = pendingRestoreId;
                          setPendingRestoreId(null);
                          setSheetState("loading");
                          try {
                            await restoreLocalBackup(rid);
                            await refreshTodaySchedule();
                            setSheetState("success");
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : "Failed to restore backup.");
                            setSheetState("error");
                          }
                        }}
                        className="h-9 px-4 rounded-xl text-xs font-bold"
                        id="btn-confirm-restore"
                      >
                        Overwrite & Restore
                      </Button>
                    </div>
                  </div>
                )}

                {/* Create Backup Box */}
                {!pendingRestoreId && (
                  <div className="space-y-2.5">
                    <label htmlFor="backup-label-input" className="text-xs font-bold uppercase tracking-wider text-muted-foreground/90 px-1">
                      Create New Backup
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="backup-label-input"
                        type="text"
                        placeholder="Label (optional, e.g. Before Exam Study)..."
                        value={backupLabel}
                        onChange={(e) => setBackupLabel(e.target.value)}
                        className="flex-1 bg-secondary/20 border border-border/80 h-11 px-4 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60 font-medium"
                      />
                      <Button
                        onClick={async () => {
                          setSheetState("loading");
                          try {
                            await createLocalBackup(backupLabel);
                            setBackupLabel("");
                            setSheetState("idle");
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : "Failed to create backup.");
                            setSheetState("error");
                          }
                        }}
                        className="h-11 px-4 rounded-xl font-medium shrink-0 flex items-center gap-1.5"
                        id="btn-create-backup"
                      >
                        <Plus className="h-4 w-4" />
                        Create Backup
                      </Button>
                    </div>
                  </div>
                )}

                {/* Saved Backups list */}
                {!pendingRestoreId && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/90 px-1">
                      Saved Local Backups ({backups.length})
                    </h4>
                    
                    {backups.length === 0 ? (
                      <div className="border border-dashed border-border/80 rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-2 bg-secondary/10">
                        <Database className="h-8 w-8 text-muted-foreground/40" />
                        <div className="space-y-0.5">
                          <p className="text-sm font-semibold text-muted-foreground/90">No local backups yet</p>
                          <p className="text-xs text-muted-foreground/70">Create a manual backup to freeze-frame your current workspace state offline.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                        {backups.map((backup) => (
                          <div 
                            key={backup.id}
                            className="bg-card border border-border/70 rounded-2xl p-4 flex justify-between items-center gap-4 hover:border-muted-foreground/20 transition-all shadow-sm"
                          >
                            <div className="space-y-1 min-w-0">
                              <p className="font-semibold text-sm truncate leading-snug">{backup.name}</p>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                                <History className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                                <span>{new Date(backup.timestamp).toLocaleString()}</span>
                                <span className="text-muted-foreground/40">•</span>
                                <span className="bg-secondary/40 px-1.5 py-0.5 rounded text-[10px] text-foreground font-medium">{backup.snapshot.timetables.length} {backup.snapshot.timetables.length === 1 ? 'timetable' : 'timetables'}</span>
                              </div>
                            </div>
                            
                            <div className="flex gap-1.5 shrink-0">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setPendingRestoreId(backup.id);
                                }}
                                className="h-8 px-3 rounded-lg text-xs font-semibold"
                                id={`btn-restore-${backup.id}`}
                              >
                                Restore
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setDeleteBackupId(backup.id);
                                }}
                                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                aria-label="Delete backup"
                                id={`btn-delete-${backup.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === "transfer" && (
              <div className="space-y-6">
                {/* Export Section */}
                <div className="bg-card border rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <Download className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">Export Workspace</h4>
                      <p className="text-xs text-muted-foreground">Download your complete configuration as a JSON file.</p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleExport}
                    className="w-full h-11 rounded-xl font-medium flex items-center justify-center gap-2"
                    id="btn-export-workspace"
                  >
                    <Download className="h-4 w-4" />
                    Download JSON File
                  </Button>
                </div>

                {/* Divider */}
                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-border/80"></div>
                  <span className="flex-shrink mx-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">OR</span>
                  <div className="flex-grow border-t border-border/80"></div>
                </div>

                {/* Import Section */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm px-1">Import Workspace</h4>
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 transition-colors cursor-pointer relative ${
                      isDragging 
                        ? "border-primary bg-primary/5 text-primary" 
                        : "border-border/80 hover:border-muted-foreground/60 hover:bg-secondary/10"
                    }`}
                    id="import-drop-zone"
                  >
                    {isTauri() ? (
                      <div 
                        className="absolute inset-0 cursor-pointer" 
                        onClick={handleNativeImport}
                        id="import-file-input"
                        aria-label="Select file to import"
                      />
                    ) : (
                      <input 
                        type="file" 
                        accept=".json"
                        onChange={handleFileChange}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        aria-label="Select file to import"
                        id="import-file-input"
                      />
                    )}
                    <div className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                      isDragging ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Upload className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">
                        Drag and drop your JSON export here
                      </p>
                      <p className="text-xs text-muted-foreground">
                        or click to choose file from your device
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* State: PREVIEW */}
        {sheetState === "preview" && previewMetadata && (
          <div className="space-y-6">
            
            {/* File Info */}
            <div className="bg-card border rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                  <FileCheck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">Valid Export File Loaded</h4>
                  <p className="text-xs text-muted-foreground">Successfully parsed and verified workspace structure.</p>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3 font-mono text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Export App Version:</span>
                  <span className="font-semibold text-foreground">{previewMetadata.appVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span>Exported Date:</span>
                  <span className="font-semibold text-foreground">
                    {new Date(previewMetadata.exportTimestamp).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-start">
                  <span>Timetables:</span>
                  <div className="text-right flex flex-col gap-0.5">
                    <span className="font-bold text-foreground">({previewMetadata.timetableCount})</span>
                    {previewMetadata.timetableNames.map((name, idx) => (
                      <span key={idx} className="text-[10px] text-muted-foreground/90">{name}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Destructive Warning Alert */}
            <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <h5 className="font-bold text-sm leading-none">Warning: Replacement Action</h5>
                <p className="text-xs leading-normal opacity-90">
                  Importing this file will **completely overwrite** all current local timetables, subject configurations, routines, and progress data on this device. This operation is irreversible and atomic.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <Button 
                variant="outline"
                onClick={() => setSheetState("idle")}
                className="h-12 rounded-xl"
                id="btn-cancel-import"
              >
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={handleConfirmImport}
                className="h-12 rounded-xl font-bold"
                id="btn-confirm-import"
              >
                Confirm & Import
              </Button>
            </div>

          </div>
        )}

        {/* State: LOADING */}
        {sheetState === "loading" && (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Processing Data</p>
              <p className="text-xs text-muted-foreground">Rerouting datasets, rebuilding local store, and syncing...</p>
            </div>
          </div>
        )}

        {/* State: SUCCESS */}
        {sheetState === "success" && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="h-16 w-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center shadow-inner">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-bold">Import Successful</p>
                <p className="text-sm text-muted-foreground px-4">
                  Your workspace has been successfully rebuilt. All schedules, custom settings, and timetables are fully integrated.
                </p>
              </div>
            </div>
            
            <Button 
              className="w-full h-12 rounded-xl font-semibold"
              onClick={onClose}
              id="btn-success-done"
            >
              Done
            </Button>
          </div>
        )}

        {/* State: ERROR */}
        {sheetState === "error" && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="h-16 w-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center shadow-inner">
                <AlertCircle className="h-10 w-10" />
              </div>
              <div className="space-y-2 px-4">
                <p className="text-lg font-bold">Import Rejected</p>
                <div className="bg-muted p-4 rounded-xl border max-h-40 overflow-y-auto text-left">
                  <p className="text-xs font-mono text-destructive leading-relaxed break-words whitespace-pre-wrap">
                    {errorMessage}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button 
                variant="outline"
                className="h-12 rounded-xl"
                onClick={onClose}
                id="btn-error-close"
              >
                Close
              </Button>
              <Button 
                className="h-12 rounded-xl font-semibold"
                onClick={() => setSheetState("idle")}
                id="btn-error-retry"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}

      </div>

      <ConfirmationDialog
        isOpen={!!deleteBackupId}
        onClose={() => setDeleteBackupId(null)}
        title="Delete Local Backup?"
        description={`Are you sure you want to permanently delete the backup "${backups.find((b) => b.id === deleteBackupId)?.name || ""}"? This action is irreversible.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={async () => {
          if (deleteBackupId) {
            const bid = deleteBackupId;
            setDeleteBackupId(null);
            setSheetState("loading");
            try {
              await deleteLocalBackup(bid);
              setSheetState("idle");
            } catch (err) {
              setErrorMessage(err instanceof Error ? err.message : "Failed to delete backup.");
              setSheetState("error");
            }
          }
        }}
      />
    </BottomSheet>
  );
}
