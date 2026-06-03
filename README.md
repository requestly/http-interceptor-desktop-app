<p align="center">
  <a rel="noreferrer noopener" href="https://requestly.io/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/requestly/http-interceptor-desktop-app/assets/16779465/84f8c853-81df-4ffc-94cb-40f0b1d122d6">
      <source media="(prefers-color-scheme: light)" srcset="https://github.com/requestly/http-interceptor-desktop-app/assets/16779465/ebadc791-4eb6-4faa-920a-a322aa4b892b">
        <img alt="Requestly Logo" src="https://github.com/requestly/http-interceptor-desktop-app/assets/16779465/84f8c853-81df-4ffc-94cb-40f0b1d122d6" width="40%">
      </picture>
  </a>
</p>

<p align="center">
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/requestly/requestly"/>
  <a rel="noreferrer noopener" href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">
    <img alt="Chrome Web Store Rating" src="https://img.shields.io/chrome-web-store/rating/mdnleldcmiljblolnjhpnblkcekpdkpa" />
  </a>
  <a rel="noreferrer noopener" href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">
    <img alt="Chrome Web Store Reviews" src="https://img.shields.io/chrome-web-store/rating-count/mdnleldcmiljblolnjhpnblkcekpdkpa?label=reviews" />
  </a>
  <a rel="noreferrer noopener" href="https://chrome.google.com/webstore/detail/redirect-url-modify-heade/mdnleldcmiljblolnjhpnblkcekpdkpa/">
    <img alt="Chrome Web Store Downloads" src="https://img.shields.io/chrome-web-store/users/mdnleldcmiljblolnjhpnblkcekpdkpa?label=downloads" />
  </a>
</p>

<p align="center">
  <a href="https://docs.requestly.io">Docs</a> - <a href="https://requestly.io/downloads">Download</a> - <a href="https://app.requestly.io/getting-started">Getting Started</a> - <a href="https://bit.ly/requestly-slack/slack">Support community</a> - <a href="https://github.com/requestly/requestly/issues/new?assignees=&labels=bug&template=bug-report.yml">Bug report</a>
</p>

<h2 align="center">Debug your network request across all platforms and browsers using a single app</h2>
This repo contains the core logic and source code for the <a href="https://requestly.io/desktop">Requestly Desktop App</a>. Download for your platform from <a href="https://requestly.io/desktop">here</a>.
<br/><br/>

- [Getting Started](#getting-started)
- [Development](#development)
  - [Setup](#setup)
  - [Run](#run)
  - [Packaging](#packaging)
- [Contributing](#contributing)
- [Links](#links)

## Getting Started

To get a local copy up and running, please follow these simple steps.

### Prerequisites
Here is what you need to be able to run Requestly Desktop App Locally.

Node.js (Version: 20.20.0)\
Npm (Version: 10.8.2)

## Development
### Setup
1. Clone the repo

```
git clone https://github.com/requestly/http-interceptor-desktop-app.git
```

2. Clone requestly-proxy. (Should be cloned in the same folder for development)

```
git clone https://github.com/requestly/requestly-proxy.git
```

3. Go to the requestly-proxy folder & Install packages with npm
```
npm i
```

4. Go to the requestly-desktop-app folder & Install packages with npm
```
npm i
```

### Run

1. Start Requestly WebApp server locally. Here are the [steps](https://github.com/requestly/requestly/tree/master/app#readme).

2. [Optional] Start watching requestly-proxy. (You can skip this step if you don't want to make any changes in requestly-proxy)
```
sh ./watch.sh
```
> After every change to **requestly-proxy**, Press `cmd + r` on background window for changes to apply

3. Start Requestly Desktop App
```
npm start
```

### Packaging
This app uses electron-builder to package and sign the app. Run this command to build the packaged version of Requestly Desktop App.
```
npm run package
```

## Contributing

Read our [contributing guide](https://github.com/requestly/requestly/blob/master/CONTRIBUTING.md) to learn about how to propose bugfixes and improvements, and how the development process works.

## Links

- 🏠 Website: [https://www.requestly.io](https://www.requestly.io)
- 📖 Documentation: [https://docs.requestly.io](https://docs.requestly.io)
- 🖥️ Download Desktop App: [https://requestly.io/desktop/](https://requestly.io/desktop/)

For **payment/billing related issues**, feel free to contact us at [contact@requestly.io](mailto:contact@requestly.io)
