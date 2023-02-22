import iris from 'iris-lib';
import { debounce } from 'lodash';

import Component from '../../BaseComponent';
import Button from '../../components/basic/Button';
import Nostr from '../../Nostr';

export default class IrisAccountSettings extends Component {
  state = {
    irisToActive: false,
    existing: null,
  };

  render() {
    let view = '';

    if (this.state.irisToActive) {
      const username = this.state.profile.nip05.split('@')[0];
      const link = `https://iris.to/${username}`;
      view = <a href={link}>iris.to/{username}</a>;
    } else if (this.state.existing && this.state.existing.confirmed) {
      view = (
        <div>
          <div className="negative">
            You have an active iris.to account iris.to/<b>{this.state.existing.name}</b>
          </div>
          <p>
            <Button onClick={() => this.setAsPrimary()}>
              Set as primary Nostr address (nip05)
            </Button>
          </p>
        </div>
      );
    } else if (this.state.existing) {
      view = (
        <div>
          <p className="positive">
            Username iris.to/<b>{this.state.existing.name}</b> is reserved for you until 5 March
            2023!
          </p>
          <p>
            <Button onClick={() => this.enableReserved()}>Yes please</Button>
          </p>
          <p>
            <Button onClick={() => this.declineReserved()}>No thanks</Button>
          </p>
        </div>
      );
    } else if (this.state.error) {
      view = <div className="negative">Error: {this.state.error}</div>;
    } else if (this.state.showChallenge) {
      window.cf_turnstile_callback = (token) => this.register(token);
      view = (
        <>
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
          <div
            className="cf-turnstile"
            data-sitekey={
              window.location.host === 'iris.to'
                ? '0x4AAAAAAACsEd8XuwpPTFwz'
                : '3x00000000000000000000FF'
            }
            data-callback="cf_turnstile_callback"
          ></div>
        </>
      );
    } else {
      view = (
        <div>
          <p>Register an Iris username (iris.to/username)</p>
          <form onSubmit={(e) => this.showChallenge(e)}>
            <input
              type="text"
              placeholder="Username"
              value={this.state.newUserName}
              onInput={(e) => this.onNewUserNameChange(e)}
            />
            <Button type="submit" enabled={this.state.newUserNameValid}>
              Register
            </Button>
            <p>
              {this.state.newUserNameValid ? (
                <span className="positive">Username is available</span>
              ) : (
                <span className="negative">{this.state.invalidUsernameMessage}</span>
              )}
            </p>
          </form>
        </div>
      );
    }

    return (
      <>
        <div class="centered-container">
          <h3>Iris account</h3>
          {view}
        </div>
      </>
    );
  }

  async onNewUserNameChange(e) {
    const newUserName = e.target.value;
    if (newUserName.length === 0) {
      this.setState({ newUserName, newUserNameValid: false, invalidUsernameMessage: '' });
      return;
    }
    if (newUserName.length < 4 || newUserName.length > 15) {
      this.setState({
        newUserName,
        newUserNameValid: false,
        invalidUsernameMessage: 'Username must be between 4 and 15 characters',
      });
      return;
    }
    if (!newUserName.match(/^[a-z0-9]+$/)) {
      this.setState({
        newUserName,
        newUserNameValid: false,
        invalidUsernameMessage: 'Username must only contain lowercase letters and numbers',
      });
      return;
    }
    this.setState({
      newUserName,
      invalidUsernameMessage: '',
    });
    this.checkAvailabilityFromAPI(newUserName);
  }

  checkAvailabilityFromAPI = debounce(async (name) => {
    const res = await fetch(`https://api.iris.to/user/available?name=${encodeURIComponent(name)}`);
    if (name !== this.state.newUserName) {
      return;
    }
    if (res.status < 500) {
      const json = await res.json();
      if (json.available) {
        this.setState({ newUserNameValid: true });
      } else {
        this.setState({
          newUserNameValid: false,
          invalidUsernameMessage: json.message,
        });
      }
    } else {
      this.setState({
        newUserNameValid: false,
        invalidUsernameMessage: 'Error checking username availability',
      });
    }
  }, 500);

  showChallenge(e) {
    e.preventDefault();
    if (!this.state.newUserNameValid) {
      return;
    }
    this.setState({ showChallenge: true });
  }

  async register(cfToken) {
    console.log('register', cfToken);
    const pubkey = iris.session.getKey().secp256k1.rpub;
    const event = {
      content: `iris.to/${this.state.newUserName}`,
      kind: 1,
      tags: [],
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
    };
    event.id = Nostr.getEventHash(event);
    event.sig = await Nostr.sign(event);
    // post signed event as request body to https://api.iris.to/user/confirm_user
    const res = await fetch('https://api.iris.to/user/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event, cfToken }),
    });
    if (res.status === 200) {
      this.setState({
        error: null,
        existing: {
          confirmed: true,
          name: this.state.newUserName,
        },
      });
      delete window.cf_turnstile_callback;
    } else {
      res
        .json()
        .then((json) => {
          this.setState({ error: json.message || 'error' });
        })
        .catch(() => {
          this.setState({ error: 'error' });
        });
    }
  }

  setAsPrimary() {
    const newNip = this.state.existing.name + '@iris.to';
    const timeout = setTimeout(() => {
      Nostr.setMetadata({ nip05: newNip });
    }, 2000);
    Nostr.getProfile(iris.session.getKey().secp256k1.rpub, (p) => {
      if (p) {
        clearTimeout(timeout);
        if (p.nip05 !== newNip) {
          p.nip05 = newNip;
          Nostr.setMetadata(p);
        }
      }
      this.setState({ profile: p, irisToActive: true });
    });
  }

  async enableReserved() {
    const pubkey = iris.session.getKey().secp256k1.rpub;
    const event = {
      content: `iris.to/${this.state.existing.name}`,
      kind: 1,
      tags: [],
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
    };
    event.id = Nostr.getEventHash(event);
    event.sig = await Nostr.sign(event);
    // post signed event as request body to https://api.iris.to/user/confirm_user
    const res = await fetch('https://api.iris.to/user/confirm_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    if (res.status === 200) {
      this.setState({ error: null, existing: { confirmed: true, name: this.state.existing.name } });
    } else {
      res
        .json()
        .then((json) => {
          this.setState({ error: json.message || 'error' });
        })
        .catch(() => {
          this.setState({ error: 'error' });
        });
    }
  }

  async declineReserved() {
    if (!confirm(`Are you sure you want to decline iris.to/${this.state.existing.name}?`)) {
      return;
    }
    const pubkey = iris.session.getKey().secp256k1.rpub;
    const event = {
      content: `decline iris.to/${this.state.existing.name}`,
      kind: 1,
      tags: [],
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
    };
    event.id = Nostr.getEventHash(event);
    event.sig = await Nostr.sign(event);
    // post signed event as request body to https://api.iris.to/user/confirm_user
    const res = await fetch('https://api.iris.to/user/decline_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    if (res.status === 200) {
      this.setState({ confirmSuccess: false, error: null, existing: null });
    } else {
      res
        .json()
        .then((json) => {
          this.setState({ error: json.message || 'error' });
        })
        .catch(() => {
          this.setState({ error: 'error' });
        });
    }
  }

  componentDidMount() {
    const myPub = iris.session.getKey().secp256k1.rpub;
    Nostr.getProfile(
      myPub,
      (profile) => {
        const irisToActive =
          profile && profile.nip05 && profile.nip05valid && profile.nip05.endsWith('@iris.to');
        this.setState({ profile, irisToActive });
        if (profile && !irisToActive) {
          this.checkExistingAccount(myPub);
        }
      },
      true,
    );
    this.checkExistingAccount(myPub);
  }

  async checkExistingAccount(pub) {
    // make a get request to https://api.iris.to/user/username_confirmable?name=${name}&public_key=${pub}
    // if the response is 200, then the account is available

    const res = await fetch(`https://api.iris.to/user/find?public_key=${pub}`);
    if (res.status === 200) {
      const json = await res.json();
      this.setState({ existing: json });
    }
  }
}