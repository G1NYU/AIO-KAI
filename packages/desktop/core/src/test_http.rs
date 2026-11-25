//! Minimal one-request loopback HTTP fixture for native transport tests.
use std::{io::{BufRead, BufReader, Read, Write}, net::TcpListener, thread, time::Duration};

pub(crate) fn response(status: u16, mime: &'static str, body: Vec<u8>) -> (String, thread::JoinHandle<String>) {
    response_after(status, mime, body, || {})
}

pub(crate) fn response_after(status: u16, mime: &'static str, body: Vec<u8>, before_write: impl FnOnce() + Send + 'static) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let worker = thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                Err(e) => panic!("fixture accept: {e}"),
            }
        };
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut reader = BufReader::new(&mut stream);
        let mut headers = String::new();
        loop {
            let mut line = String::new();
            assert!(reader.read_line(&mut line).unwrap() > 0);
            if line == "\r\n" { break; }
            headers.push_str(&line);
            assert!(headers.len() < 16384);
        }
        let length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().unwrap())
        }).unwrap_or(0);
        assert!(length < 16384);
        let mut input = vec![0; length];
        reader.read_exact(&mut input).unwrap();
        drop(reader);
        before_write();
        write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        stream.write_all(&body).unwrap();
        headers + "\r\n" + &String::from_utf8_lossy(&input)
    });
    (format!("http://{address}/"), worker)
}
