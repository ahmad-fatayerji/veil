//! The library supplies activity serialization and RPC commands. This Windows
//! transport adds deadlines, bounded replies, and acknowledgement draining so an
//! unresponsive Discord cannot stall privacy changes or fill its IPC buffers.
#[cfg(windows)]
mod windows {
    use super::super::DisplayActivity;
    use discord_rich_presence::{activity::Activity, error::Error, DiscordIpc};
    use serde_json::{json, Value};
    use std::{
        io,
        time::{Duration, Instant},
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::windows::named_pipe::{ClientOptions, NamedPipeClient},
        runtime::Runtime,
    };

    const APPLICATION_ID: &str = "1562757675970863135";
    const IO_TIMEOUT: Duration = Duration::from_secs(1);

    pub struct Client {
        runtime: Option<Runtime>,
        pipe: Option<NamedPipeClient>,
        deadline: Instant,
    }

    impl Client {
        pub fn new() -> Self {
            Self {
                runtime: tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .ok(),
                pipe: None,
                deadline: Instant::now(),
            }
        }

        pub fn connect(&mut self) -> Result<(), ()> {
            self.deadline = Instant::now() + IO_TIMEOUT;
            DiscordIpc::connect(self).map_err(|_| ())
        }

        pub fn publish(&mut self, display: &DisplayActivity) -> Result<(), ()> {
            self.deadline = Instant::now() + IO_TIMEOUT;
            let mut activity = Activity::new().details(display.details.as_str());
            if let Some(state) = &display.state {
                activity = activity.state(state.as_str());
            }
            self.set_activity(activity).map_err(|_| ())?;
            self.acknowledge()
        }

        pub fn clear(&mut self) -> Result<(), ()> {
            self.deadline = Instant::now() + IO_TIMEOUT;
            self.clear_activity().map_err(|_| ())?;
            self.acknowledge()
        }

        fn acknowledge(&mut self) -> Result<(), ()> {
            let (opcode, response) = self.recv().map_err(|_| ())?;
            if opcode == 1 && response["cmd"] == "SET_ACTIVITY" && response["evt"] != "ERROR" {
                Ok(())
            } else {
                Err(())
            }
        }

        pub fn disconnect(&mut self) {
            self.pipe = None;
        }
    }

    impl DiscordIpc for Client {
        fn get_client_id(&self) -> &str {
            APPLICATION_ID
        }

        fn connect_ipc(&mut self) -> Result<(), Error> {
            let runtime = self.runtime.as_ref().ok_or(Error::IPCConnectionFailed)?;
            let _entered = runtime.enter();
            for index in 0..10 {
                if let Ok(pipe) =
                    ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{index}"))
                {
                    self.pipe = Some(pipe);
                    return Ok(());
                }
            }
            Err(Error::IPCConnectionFailed)
        }

        fn send_handshake(&mut self) -> Result<(), Error> {
            self.send(json!({ "v": 1, "client_id": APPLICATION_ID }), 0)?;
            let (opcode, response) = self.recv()?;
            if opcode == 1 && response["evt"] == "READY" {
                Ok(())
            } else {
                Err(Error::IPCConnectionFailed)
            }
        }

        fn write(&mut self, data: &[u8]) -> Result<(), Error> {
            let runtime = self.runtime.as_ref().ok_or(Error::NotConnected)?;
            let pipe = self.pipe.as_mut().ok_or(Error::NotConnected)?;
            let remaining = self.deadline.saturating_duration_since(Instant::now());
            runtime.block_on(async {
                tokio::time::timeout(remaining, pipe.write_all(data))
                    .await
                    .map_err(|_| Error::WriteError(io::ErrorKind::TimedOut.into()))?
                    .map_err(Error::WriteError)
            })
        }

        fn read(&mut self, buffer: &mut [u8]) -> Result<(), Error> {
            let runtime = self.runtime.as_ref().ok_or(Error::NotConnected)?;
            let pipe = self.pipe.as_mut().ok_or(Error::NotConnected)?;
            let remaining = self.deadline.saturating_duration_since(Instant::now());
            runtime.block_on(async {
                tokio::time::timeout(remaining, pipe.read_exact(buffer))
                    .await
                    .map_err(|_| Error::ReadError(io::ErrorKind::TimedOut.into()))?
                    .map(|_| ())
                    .map_err(Error::ReadError)
            })
        }

        fn recv(&mut self) -> Result<(u32, Value), Error> {
            for _ in 0..8 {
                let mut header = [0; 8];
                self.read(&mut header)?;
                let opcode = u32::from_le_bytes(header[..4].try_into().unwrap());
                let length = u32::from_le_bytes(header[4..].try_into().unwrap());
                if length > 64 * 1024 {
                    return Err(Error::DecodeHeader);
                }
                let mut payload = vec![0; length as usize];
                self.read(&mut payload)?;
                if opcode == 3 {
                    // Echo Discord's ping as a pong without extending the deadline.
                    self.write(&4_u32.to_le_bytes())?;
                    self.write(&length.to_le_bytes())?;
                    self.write(&payload)?;
                    continue;
                }
                let response =
                    serde_json::from_slice(&payload).map_err(|_| Error::JsonParseResponse)?;
                return Ok((opcode, response));
            }
            Err(Error::DecodeOpcode)
        }

        fn close(&mut self) -> Result<(), Error> {
            self.disconnect();
            Ok(())
        }
    }
}

#[cfg(windows)]
pub use windows::Client;

// Veil's supported native target is Windows. Other build targets do not connect.
#[cfg(not(windows))]
pub struct Client;
#[cfg(not(windows))]
impl Client {
    pub fn new() -> Self {
        Self
    }
    pub fn connect(&mut self) -> Result<(), ()> {
        Err(())
    }
    pub fn publish(&mut self, _: &super::DisplayActivity) -> Result<(), ()> {
        Err(())
    }
    pub fn clear(&mut self) -> Result<(), ()> {
        Ok(())
    }
    pub fn disconnect(&mut self) {}
}
