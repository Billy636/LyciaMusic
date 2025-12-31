when i run 'npm run tauri build' there are some issues here!fix it !
 
(base) PS C:\Users\lover\Desktop\my-cloud-music> npm run tauri build

> my-cloud-music@0.1.0 tauri
> tauri build

        Info Looking up installed tauri packages to check mismatched versions...
     Running beforeBuildCommand `npm run build`

> my-cloud-music@0.1.0 build
> vue-tsc --noEmit && vite build

src/App.vue:15:63 - error TS6133: 'addSongsToQueue' is declared but its value is never read.

15 const { init, showAddToPlaylistModal, playlistAddTargetSongs, addSongsToQueue, settings, playQueue } = usePlayer();
                                                                 ~~~~~~~~~~~~~~~

src/App.vue:38:3 - error TS2304: Cannot find name 'addSongsToPlaylist'.

38   addSongsToPlaylist(playlistId, playlistAddTargetSongs.value);
     ~~~~~~~~~~~~~~~~~~

src/components/overlays/FolderContextMenu.vue:77:6 - error TS2345: Argument of type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to parameter of type 'HTMLAttributes & ReservedProps & Record<string, unknown>'.
  Type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to type 'HTMLAttributes'.
    Types of property 'style' are incompatible.
      Type '{ left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
        Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
          Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'CSSProperties'.
            Types of property 'visibility' are incompatible.
              Type 'string' is not assignable to type 'Visibility | undefined'.

77     <div
        ~~~

src/components/overlays/FooterContextMenu.vue:77:6 - error TS2345: Argument of type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to parameter of type 'HTMLAttributes & ReservedProps & Record<string, unknown>'.
  Type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to type 'HTMLAttributes'.
    Types of property 'style' are incompatible.
      Type '{ left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
        Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
          Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'CSSProperties'.
            Types of property 'visibility' are incompatible.
              Type 'string' is not assignable to type 'Visibility | undefined'.

77     <div
        ~~~

src/components/overlays/PlaylistContextMenu.vue:76:6 - error TS2345: Argument of type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to parameter of type 'HTMLAttributes & ReservedProps & Record<string, unknown>'.
  Type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to type 'HTMLAttributes'.
    Types of property 'style' are incompatible.
      Type '{ left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
        Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
          Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'CSSProperties'.
            Types of property 'visibility' are incompatible.
              Type 'string' is not assignable to type 'Visibility | undefined'.

76     <div
        ~~~

src/components/overlays/SongContextMenu.vue:113:6 - error TS2345: Argument of type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to parameter of type 'HTMLAttributes & ReservedProps & Record<string, unknown>'.
  Type '{ style: { left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }; class: string; ref: string; onContextmenu: () => void; }' is not assignable to type 'HTMLAttributes'.
    Types of property 'style' are incompatible.
      Type '{ left?: undefined; top?: undefined; visibility?: undefined; } | { left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
        Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'StyleValue'.
          Type '{ left: string; top: string; visibility: string; }' is not assignable to type 'CSSProperties'.
            Types of property 'visibility' are incompatible.
              Type 'string' is not assignable to type 'Visibility | undefined'.

113     <div
         ~~~


Found 6 errors in 5 files.

Errors  Files
     2  src/App.vue:15
     1  src/components/overlays/FolderContextMenu.vue:77
     1  src/components/overlays/FooterContextMenu.vue:77
     1  src/components/overlays/PlaylistContextMenu.vue:76
     1  src/components/overlays/SongContextMenu.vue:113
beforeBuildCommand `npm run build` failed with exit code 2
       Error beforeBuildCommand `npm run build` failed with exit code 2


Important notes:
it is Tauri v2.0,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.