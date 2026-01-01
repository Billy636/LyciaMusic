(base) PS C:\Users\lover\Desktop\my-cloud-music> npm run tauri dev

> lycia-music@1.0.0 tauri
> tauri dev

     Running BeforeDevCommand (`npm run dev`)

> lycia-music@1.0.0 dev
> vite


  VITE v6.4.1  ready in 251 ms

  ➜  Local:   http://localhost:1420/
     Running DevCommand (`cargo  run --no-default-features --color always --`)
        Info Watching C:\Users\lover\Desktop\my-cloud-music\src-tauri for changes...
   Compiling lycia_music v1.0.0 (C:\Users\lover\Desktop\my-cloud-music\src-tauri)
error[E0425]: cannot find function `get_output_devices` in this scope
   --> src\lib.rs:103:13
    |
103 |             get_output_devices,
    |             ^^^^^^^^^^^^^^^^^^ not found in this scope
    |
help: consider importing this function
    |
  7 + use crate::player::get_output_devices;
    |

error[E0425]: cannot find function `set_output_device` in this scope
   --> src\lib.rs:104:13
    |
104 |             set_output_device
    |             ^^^^^^^^^^^^^^^^^ not found in this scope
    |
help: consider importing this function
    |
  7 + use crate::player::set_output_device;
    |

error: this function depends on never type fallback being `()`
   --> src\lib.rs:26:1
    |
 26 | pub fn run() {
    | ^^^^^^^^^^^^
    |
    = warning: this was previously accepted by the compiler but is being phased out; it will become a hard error in Rust 2024 and in a future release in all editions!
    = note: for more information, see <https://doc.rust-lang.org/edition-guide/rust-2024/never-type-fallback.html>
    = help: specify the types explicitly
note: in edition 2024, the requirement `!: Deserialize<'_>` will fail
   --> src\player.rs:49:1
    |
 49 |   #[tauri::command]
    |   ^^^^^^^^^^^^^^^^^
    |
   ::: src\lib.rs:85:25
    |
 85 |           .invoke_handler(tauri::generate_handler![
    |  _________________________-
 86 | |             scan_music_folder,
 87 | |             scan_folder_as_playlists,
 88 | |             get_song_cover_thumbnail,
...   |
104 | |             set_output_device
105 | |         ])
    | |_________- in this macro invocation
    = note: `#[deny(dependency_on_unit_never_type_fallback)]` (part of `#[deny(rust_2024_compatibility)]`) on by default
    = note: this error originates in the macro `__cmd__set_output_device` which comes from the expansion of the macro `tauri::generate_handler` (in Nightly builds, run with -Z macro-backtrace for more info)

For more information about this error, try `rustc --explain E0425`.
error: could not compile `lycia_music` (lib) due to 4 previous errors