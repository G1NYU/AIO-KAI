pub mod bridge;
#[cfg(windows)]
pub mod backup_store;
pub mod discord;
pub mod downloads;
pub mod external;
pub mod licenses;
pub mod logs;
pub mod mpv;
pub mod music_audio;
mod music_resolver;
mod music_stream;
pub mod now_playing;
pub mod playback;
pub mod player;
#[cfg(windows)]
pub mod read_runtime;
pub mod render;
pub mod sound;
pub mod thumbnails;
pub mod upscale;
pub mod youtube;
pub mod torbox;
pub mod vault_gateway;
#[cfg(windows)]
pub mod vault_engine;
#[cfg(windows)]
pub mod media_tools;

#[cfg(test)]
pub(crate) mod test_http;
