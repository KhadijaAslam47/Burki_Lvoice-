import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(
  "https://animated-meme-wp9jgp5qwwwc9xw6-3000.app.github.dev",
  { autoConnect: false }
);

const iceServers = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const defaultRooms = [
  { id: 1, name: "Live Voice Room", users: 12, icon: "🎤" },
  { id: 2, name: "Music & Friends", users: 8, icon: "🎵" },
  { id: 3, name: "Chat Lounge", users: 15, icon: "💬" },
  { id: 4, name: "Friends Club", users: 6, icon: "❤️" },
];

const defaultProfile = {
  name: "",
  gender: "Male",
  birthday: "",
  country: "Pakistan",
  province: "",
  tag: "",
  signature: "",
  picture: "",
};

const countryOptions = [
  "Pakistan", "United States", "United Kingdom", "Canada",
  "India", "United Arab Emirates", "Saudi Arabia", "Australia",
  "Germany", "France", "Italy", "Spain", "Turkey", "China",
  "Japan", "Bangladesh", "Afghanistan", "Malaysia",
  "Indonesia", "Other",
];

const provinceOptions = {
  Pakistan: [
    "Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan",
    "Islamabad", "Gilgit-Baltistan", "Azad Jammu and Kashmir",
  ],
  "United States": [
    "Alabama", "Alaska", "Arizona", "California", "Florida",
    "Illinois", "New York", "Texas", "Washington", "Other",
  ],
  "United Kingdom": [
    "England", "Scotland", "Wales", "Northern Ireland",
  ],
  Canada: [
    "Alberta", "British Columbia", "Manitoba",
    "New Brunswick", "Ontario", "Quebec",
    "Saskatchewan", "Other",
  ],
  India: [
    "Delhi", "Gujarat", "Haryana", "Karnataka",
    "Maharashtra", "Punjab", "Rajasthan",
    "Uttar Pradesh", "Other",
  ],
  "United Arab Emirates": [
    "Abu Dhabi", "Dubai", "Sharjah", "Ajman",
    "Fujairah", "Ras Al Khaimah", "Umm Al Quwain",
  ],
  Australia: [
    "New South Wales", "Queensland", "South Australia",
    "Tasmania", "Victoria", "Western Australia",
  ],
};

function App() {
  const [activeTab, setActiveTab] = useState("My");
  const [rooms, setRooms] = useState(defaultRooms);

  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const [currentRoom, setCurrentRoom] = useState(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [seats, setSeats] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);

  const [showProfile, setShowProfile] = useState(false);

  const [profile, setProfile] = useState(() => {
    try {
      return {
        ...defaultProfile,
        ...JSON.parse(localStorage.getItem("burkiProfile") || "{}"),
      };
    } catch {
      return defaultProfile;
    }
  });

  const [draftProfile, setDraftProfile] = useState(profile);

  const fileInput = useRef(null);
  const localStream = useRef(null);
  const peers = useRef(new Map());
  const pendingCandidates = useRef(new Map());

  useEffect(() => {
    const makePeer = (userId) => {
      if (peers.current.has(userId)) {
        return peers.current.get(userId);
      }

      const pc = new RTCPeerConnection(iceServers);

      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStream.current);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("voice-ice-candidate", {
            to: userId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];

        if (stream) {
          setRemoteStreams((previous) => [
            ...previous.filter((item) => item.userId !== userId),
            { userId, stream },
          ]);
        }
      };

      peers.current.set(userId, pc);
      return pc;
    };

    const flushCandidates = async (userId, pc) => {
      const candidates = pendingCandidates.current.get(userId) || [];

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.error("ICE candidate error:", error);
        }
      }

      pendingCandidates.current.delete(userId);
    };

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onMessage = (data) =>
      setMessages((previous) => [...previous, data]);

    const onSeatsUpdate = (data) => setSeats(data);
    const onSeatError = (error) => alert(error);

    // Server se rooms ki list receive karna
    const onRoomsList = (data) => {
      const customRooms = (Array.isArray(data) ? data : []).map((room) => ({
        ...room,
        icon: room.icon || "🎤",
        users: room.users || 0,
      }));

      setRooms([...defaultRooms, ...customRooms]);
    };

    const onUserJoined = async (userId) => {
      try {
        const pc = makePeer(userId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("voice-offer", {
          to: userId,
          offer: pc.localDescription,
        });
      } catch (error) {
        console.error("Voice offer error:", error);
      }
    };

    const onVoiceOffer = async ({ from, offer }) => {
      try {
        const pc = makePeer(from);
        await pc.setRemoteDescription(offer);
        await flushCandidates(from, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("voice-answer", {
          to: from,
          answer: pc.localDescription,
        });
      } catch (error) {
        console.error("Voice answer error:", error);
      }
    };

    const onVoiceAnswer = async ({ from, answer }) => {
      try {
        const pc = peers.current.get(from);

        if (pc) {
          await pc.setRemoteDescription(answer);
          await flushCandidates(from, pc);
        }
      } catch (error) {
        console.error("Remote answer error:", error);
      }
    };

    const onIceCandidate = async ({ from, candidate }) => {
      const pc = peers.current.get(from);

      if (!pc || !pc.remoteDescription) {
        const previous = pendingCandidates.current.get(from) || [];
        pendingCandidates.current.set(from, [...previous, candidate]);
        return;
      }

      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("ICE error:", error);
      }
    };

    const onUserLeft = (userId) => {
      const pc = peers.current.get(userId);

      if (pc) {
        pc.close();
        peers.current.delete(userId);
      }

      pendingCandidates.current.delete(userId);

      setRemoteStreams((previous) =>
        previous.filter((item) => item.userId !== userId)
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("chat-message", onMessage);
    socket.on("seats-update", onSeatsUpdate);
    socket.on("seat-error", onSeatError);
    socket.on("rooms-list", onRoomsList);
    socket.on("voice-user-joined", onUserJoined);
    socket.on("voice-offer", onVoiceOffer);
    socket.on("voice-answer", onVoiceAnswer);
    socket.on("voice-ice-candidate", onIceCandidate);
    socket.on("voice-user-left", onUserLeft);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("chat-message", onMessage);
      socket.off("seats-update", onSeatsUpdate);
      socket.off("seat-error", onSeatError);
      socket.off("rooms-list", onRoomsList);
      socket.off("voice-user-joined", onUserJoined);
      socket.off("voice-offer", onVoiceOffer);
      socket.off("voice-answer", onVoiceAnswer);
      socket.off("voice-ice-candidate", onIceCandidate);
      socket.off("voice-user-left", onUserLeft);

      peers.current.forEach((pc) => pc.close());
      peers.current.clear();
    };
  }, []);

  // Profile save
  const saveProfile = (updatedProfile) => {
    try {
      localStorage.setItem("burkiProfile", JSON.stringify(updatedProfile));
      setProfile(updatedProfile);
      setDraftProfile(updatedProfile);
      return true;
    } catch {
      alert("Unable to save. Please choose a smaller profile picture.");
      return false;
    }
  };

  const updateDraft = (field, value) => {
    setDraftProfile((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "country" ? { province: "" } : {}),
    }));
  };

  const saveAllProfile = () => {
    if (!draftProfile.name.trim()) {
      alert("Please enter your username.");
      return;
    }

    const updated = {
      ...draftProfile,
      name: draftProfile.name.trim(),
      tag: draftProfile.tag.trim(),
      signature: draftProfile.signature.trim(),
    };

    if (saveProfile(updated)) {
      alert("Profile saved successfully ❤️");
      setShowProfile(false);
    }
  };

  const openProfile = () => {
    setDraftProfile(profile);
    setShowProfile(true);
  };

  const changeProfilePic = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert("Please select an image smaller than 2 MB.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setDraftProfile((previous) => ({
        ...previous,
        picture: reader.result,
      }));
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  };

  // Create Room
  const createRoom = () => {
    const name = newRoomName.trim();

    if (!name) {
      alert("Please enter room name.");
      return;
    }

    const sendRequest = () => {
      socket.emit(
        "create-room",
        {
          name,
          ownerName: profile.name || "Room Owner",
        },
        (result) => {
          if (!result?.success) {
            alert(result?.error || "Room could not be created.");
            return;
          }

          setShowCreateRoom(false);
          setNewRoomName("");
          alert("Your room has been created successfully! ❤️");
        }
      );
    };

    if (socket.connected) {
      sendRequest();
    } else {
      socket.once("connect", sendRequest);
      socket.connect();
    }
  };

  // Join Room
  const joinRoom = async (room) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      localStream.current = stream;
      setMicEnabled(true);
      setMessages([]);
      setSeats([]);
      setRemoteStreams([]);
      setCurrentRoom(room);

      if (!socket.connected) {
        socket.connect();
      }

      socket.emit("join-room", String(room.id));
    } catch (error) {
      console.error("Microphone error:", error);
      alert("Please allow microphone permission and try again.");
    }
  };

  const leaveRoom = () => {
    if (currentRoom) {
      socket.emit("leave-room", String(currentRoom.id));
    }

    peers.current.forEach((pc) => pc.close());
    peers.current.clear();
    pendingCandidates.current.clear();

    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = null;
    }

    setCurrentRoom(null);
    setMessages([]);
    setSeats([]);
    setRemoteStreams([]);
    setMicEnabled(false);
  };

  const toggleMic = () => {
    if (!localStream.current) return;

    const nextState = !micEnabled;

    localStream.current.getAudioTracks().forEach((track) => {
      track.enabled = nextState;
    });

    setMicEnabled(nextState);
  };

  const sendMessage = () => {
    if (!message.trim() || !currentRoom) return;

    socket.emit("chat-message", {
      roomId: String(currentRoom.id),
      message: message.trim(),
    });

    setMessage("");
  };

  const toggleSeat = (index) => {
    const occupiedSeat = seats.find((seat) => seat.index === index);

    if (occupiedSeat?.userId === socket.id) {
      socket.emit("seat-leave");
    } else if (!occupiedSeat) {
      socket.emit("seat-join", index);
    }
  };

  const ProfileAvatar = ({ size = 70, picture = profile.picture }) => (
    <div className="profile-avatar" style={{ width: size, height: size }}>
      {picture ? <img src={picture} alt="Profile" /> : <span>👤</span>}
    </div>
  );

  const profileRows = [
    ["name", "Username", "Set username"],
    ["gender", "Gender", "Select"],
    ["birthday", "Birthday", "Set birthday"],
    ["country", "Country", "Select"],
    ["province", "Province / State", "Select"],
    ["tag", "Tag", "Add tag"],
    ["signature", "Signature", "Add signature"],
  ];

  // Profile Page
  if (showProfile) {
    return (
      <div className="profile-page">
        <header className="profile-header">
          <button onClick={() => setShowProfile(false)}>‹</button>
          <h2>Profile</h2>
          <span />
        </header>

        <main className="profile-settings">
          <button
            className="profile-picture-row"
            onClick={() => fileInput.current?.click()}
          >
            <div>
              <h3>Profile Picture</h3>
              <p>Tap to change your picture</p>
            </div>
            <ProfileAvatar size={82} picture={draftProfile.picture} />
          </button>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={changeProfilePic}
          />

          <div className="profile-notice">
            Please upload an appropriate profile picture.
          </div>

          <div className="profile-form">
            {profileRows.map(([field, label, placeholder]) => (
              <label className="profile-edit-field" key={field}>
                <span>{label}</span>

                {field === "gender" ? (
                  <select
                    value={draftProfile.gender}
                    onChange={(e) => updateDraft(field, e.target.value)}
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                ) : field === "country" ? (
                  <select
                    value={draftProfile.country}
                    onChange={(e) => updateDraft(field, e.target.value)}
                  >
                    <option value="">Select Country</option>
                    {countryOptions.map((country) => (
                      <option key={country} value={country}>{country}</option>
                    ))}
                  </select>
                ) : field === "province" ? (
                  provinceOptions[draftProfile.country] ? (
                    <select
                      value={draftProfile.province}
                      onChange={(e) => updateDraft(field, e.target.value)}
                    >
                      <option value="">Select Province / State</option>
                      {provinceOptions[draftProfile.country].map((province) => (
                        <option key={province} value={province}>{province}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={draftProfile.province}
                      onChange={(e) => updateDraft(field, e.target.value)}
                      placeholder="Enter Province / State"
                    />
                  )
                ) : field === "birthday" ? (
                  <input
                    type="date"
                    value={draftProfile.birthday}
                    onChange={(e) => updateDraft(field, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    value={draftProfile[field]}
                    onChange={(e) => updateDraft(field, e.target.value)}
                    placeholder={placeholder}
                    maxLength={field === "name" ? 30 : 80}
                  />
                )}
              </label>
            ))}
          </div>

          <button className="profile-save-button" onClick={saveAllProfile}>
            Save Changes
          </button>
        </main>
      </div>
    );
  }

  // Voice Room
  if (currentRoom) {
    return (
      <div className="app">
        <header className="topbar">
          <button onClick={leaveRoom}>← Back</button>
          <h2>BURKI <span>LIVE</span></h2>
          <span>{connected ? "🟢 Online" : "🔴 Offline"}</span>
        </header>

        <main className="room">
          <div className="room-heading">
            <div>
              <h2>❤️ {currentRoom.name}</h2>
              <p>Welcome to BURKI LIVE</p>
            </div>
            <span>👥 {seats.length}/15</span>
          </div>

          <div className="heart-stage">
            <div className="heart-glow">❤️</div>

            <div className="seats">
              {Array.from({ length: 15 }, (_, i) => {
                const occupiedSeat = seats.find((seat) => seat.index === i);
                const isMine = occupiedSeat?.userId === socket.id;

                return (
                  <button
                    className="seat"
                    key={i}
                    onClick={() => toggleSeat(i)}
                  >
                    {occupiedSeat ? (
                      <>
                        <span>👤</span>
                        <small>{isMine ? "You" : "User"}</small>
                      </>
                    ) : (
                      <>
                        <span>＋</span>
                        <small>{i + 1}</small>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <section className="chat">
            <h3>Room Chat</h3>

            <div className="chat-messages">
              {messages.map((msg, i) => (
                <p key={i}>
                  💬 {msg.user === socket.id ? "You" : "Guest"}: {msg.message}
                </p>
              ))}
            </div>
          </section>

          <div className="remote-audio">
            {remoteStreams.map((remote) => (
              <audio
                key={remote.userId}
                autoPlay
                playsInline
                ref={(element) => {
                  if (element && element.srcObject !== remote.stream) {
                    element.srcObject = remote.stream;
                    element.play().catch(() => {});
                  }
                }}
              />
            ))}
          </div>
        </main>

        <footer className="controls">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Say Hi..."
          />
          <button onClick={sendMessage}>➤</button>
          <button onClick={toggleMic}>
            {micEnabled ? "🎤 Mic ON" : "🔇 Mic OFF"}
          </button>
          <button>🎁</button>
          <button>💬</button>
          <button>☰</button>
        </footer>
      </div>
    );
  }

  // Home Page
  return (
    <div className="app">
      <header className="topbar">
        <h2>BURKI <span>LIVE</span></h2>

        <div className="top-actions">
          <span>🪙 0</span>
          <button>☰</button>
        </div>
      </header>

      <nav className="tabs">
        {["My", "Popular", "New"].map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "selected" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <section className="welcome">
        <h1>Welcome to <span>BURKI LIVE</span></h1>
        <p>Meet people • Make friends • Enjoy voice chat</p>
      </section>

      {/* Create Room Button */}
      <button
        className="create-room-button"
        onClick={() => setShowCreateRoom(true)}
      >
        ＋ Create Room
      </button>

      {/* Create Room Popup */}
      {showCreateRoom && (
        <div className="create-room-overlay">
          <div className="create-room-modal">
            <h2>Create Your Room ❤️</h2>

            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Enter room name"
              maxLength={40}
            />

            <div className="create-room-actions">
              <button
                onClick={() => {
                  setShowCreateRoom(false);
                  setNewRoomName("");
                }}
              >
                Cancel
              </button>

              <button onClick={createRoom}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="room-list">
        <div className="list-heading">
          <h2>{activeTab} Rooms</h2>
          <span>View All →</span>
        </div>

        {rooms.map((room) => (
          <div className="room-card" key={room.id}>
            <div className="room-icon">{room.icon}</div>

            <div className="room-info">
              <h3>{room.name}</h3>
              <p>🎙️ Voice Room</p>
              <small>🟢 {room.users} Online</small>
            </div>

            <button
              className="join-button"
              onClick={() => joinRoom(room)}
            >
              Join
            </button>
          </div>
        ))}
      </main>

      <footer className="home-footer">
        <button>🏠<small>Home</small></button>
        <button>🔥<small>Popular</small></button>
        <button>🎤<small>Live</small></button>
        <button>💬<small>Messages</small></button>

        <button onClick={openProfile}>
          <ProfileAvatar size={28} />
          <small>Profile</small>
        </button>
      </footer>
    </div>
  );
}

export default App;
