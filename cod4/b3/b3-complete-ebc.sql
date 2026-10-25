-- phpMyAdmin SQL Dump
-- version 5.1.1deb5ubuntu1
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Jan 09, 2024 at 10:26 PM
-- Server version: 10.6.12-MariaDB-0ubuntu0.22.04.1
-- PHP Version: 8.1.2-1ubuntu2.14

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `b3`
--

-- --------------------------------------------------------

--
-- Table structure for table `aliases`
--

CREATE TABLE `aliases` (
  `id` int(10) UNSIGNED NOT NULL,
  `num_used` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `alias` varchar(32) NOT NULL DEFAULT '',
  `client_id` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `time_add` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `time_edit` int(10) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `clients`
--

CREATE TABLE `clients` (
  `id` int(11) UNSIGNED NOT NULL,
  `ip` varchar(16) NOT NULL DEFAULT '',
  `connections` int(11) UNSIGNED NOT NULL DEFAULT 0,
  `guid` varchar(36) NOT NULL DEFAULT '',
  `pbid` varchar(32) NOT NULL DEFAULT '',
  `name` varchar(32) NOT NULL DEFAULT '',
  `auto_login` tinyint(1) UNSIGNED NOT NULL DEFAULT 0,
  `mask_level` tinyint(1) UNSIGNED NOT NULL DEFAULT 0,
  `group_bits` mediumint(8) UNSIGNED NOT NULL DEFAULT 0,
  `greeting` varchar(128) NOT NULL DEFAULT '',
  `time_add` int(11) UNSIGNED NOT NULL DEFAULT 0,
  `time_edit` int(11) UNSIGNED NOT NULL DEFAULT 0,
  `password` varchar(32) DEFAULT NULL,
  `login` varchar(255) DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

--
-- Dumping data for table `clients`
--

INSERT INTO `clients` (`id`, `ip`, `connections`, `guid`, `pbid`, `name`, `auto_login`, `mask_level`, `group_bits`, `greeting`, `time_add`, `time_edit`, `password`, `login`) VALUES
(1, '', 4, 'WORLD', 'WORLD', 'World', 1, 0, 0, '', 1704832928, 1704833210, '', '');

-- --------------------------------------------------------

--
-- Table structure for table `cmdgrants`
--

CREATE TABLE `cmdgrants` (
  `id` int(11) NOT NULL,
  `commands` text NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `current_clients`
--

CREATE TABLE `current_clients` (
  `id` int(3) NOT NULL,
  `Updated` varchar(25) NOT NULL,
  `Name` varchar(32) NOT NULL,
  `Level` int(10) NOT NULL,
  `DBID` int(10) NOT NULL,
  `CID` varchar(32) NOT NULL,
  `Joined` varchar(25) NOT NULL,
  `Connections` int(11) NOT NULL,
  `State` int(1) NOT NULL,
  `Score` int(10) NOT NULL,
  `IP` varchar(16) NOT NULL,
  `GUID` varchar(36) NOT NULL,
  `PBID` varchar(32) NOT NULL,
  `Team` int(1) NOT NULL,
  `ColorName` varchar(32) NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `current_svars`
--

CREATE TABLE `current_svars` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `value` varchar(255) NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

--
-- Dumping data for table `current_svars`
--


-- --------------------------------------------------------

--
-- Table structure for table `data`
--

CREATE TABLE `data` (
  `data_key` varchar(255) NOT NULL,
  `data_value` varchar(255) NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

--
-- Dumping data for table `data`
--


-- --------------------------------------------------------

--
-- Table structure for table `groups`
--

CREATE TABLE `groups` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(32) NOT NULL DEFAULT '',
  `keyword` varchar(32) NOT NULL DEFAULT '',
  `level` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `time_edit` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `time_add` int(10) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

--
-- Dumping data for table `groups`
--

INSERT INTO `groups` (`id`, `name`, `keyword`, `level`, `time_edit`, `time_add`) VALUES
(128, 'Super Admin', 'superadmin', 100, 0, 1704832927),
(64, 'Senior Admin', 'senioradmin', 80, 0, 1704832927),
(32, 'Full Admin', 'fulladmin', 60, 0, 1704832927),
(16, 'Admin', 'admin', 40, 0, 1704832927),
(8, 'Moderator', 'mod', 20, 0, 1704832927),
(2, 'Regular', 'reg', 2, 0, 1704832927),
(1, 'User', 'user', 1, 0, 1704832927),
(0, 'Guest', 'guest', 0, 0, 1704832927);

-- --------------------------------------------------------

--
-- Table structure for table `ipaliases`
--

CREATE TABLE `ipaliases` (
  `id` int(10) UNSIGNED NOT NULL,
  `num_used` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `ip` varchar(16) NOT NULL,
  `client_id` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `time_add` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `time_edit` int(10) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `nicks`
--

CREATE TABLE `nicks` (
  `id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `name` varchar(32) NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `penalties`
--

CREATE TABLE `penalties` (
  `id` int(10) UNSIGNED NOT NULL,
  `type` enum('Ban','TempBan','Kick','Warning','Notice') NOT NULL DEFAULT 'Ban',
  `client_id` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `admin_id` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `duration` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `inactive` tinyint(1) UNSIGNED NOT NULL DEFAULT 0,
  `keyword` varchar(16) NOT NULL DEFAULT '',
  `reason` varchar(255) NOT NULL DEFAULT '',
  `data` varchar(255) NOT NULL DEFAULT '',
  `time_add` int(11) UNSIGNED NOT NULL DEFAULT 0,
  `time_edit` int(11) UNSIGNED NOT NULL DEFAULT 0,
  `time_expire` int(11) NOT NULL DEFAULT 0
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `player_core`
--

CREATE TABLE `player_core` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(32) DEFAULT NULL,
  `guid` varchar(32) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `status` varchar(32) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL DEFAULT 'default',
  `style` varchar(32) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL DEFAULT 'default',
  `winterprestige` int(11) NOT NULL DEFAULT 0,
  `summerprestige` int(11) NOT NULL DEFAULT 0,
  `prestige` int(11) NOT NULL DEFAULT 0,
  `backup_pr` int(11) NOT NULL DEFAULT 0,
  `season` varchar(32) DEFAULT 'null',
  `award_tier` int(11) NOT NULL DEFAULT 0,
  `donation_tier` int(11) NOT NULL DEFAULT 0,
  `donation_date` varchar(16) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

--
-- Dumping data for table `player_core`
--


-- --------------------------------------------------------

--
-- Table structure for table `prestige_log`
--

CREATE TABLE `prestige_log` (
  `id` int(11) NOT NULL,
  `guid` varchar(19) NOT NULL,
  `name` varchar(40) NOT NULL,
  `prestige` int(11) NOT NULL,
  `time` varchar(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `aliases`
--
ALTER TABLE `aliases`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `alias` (`alias`,`client_id`),
  ADD KEY `client_id` (`client_id`);

--
-- Indexes for table `clients`
--
ALTER TABLE `clients`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `guid` (`guid`),
  ADD KEY `group_bits` (`group_bits`),
  ADD KEY `name` (`name`);

--
-- Indexes for table `cmdgrants`
--
ALTER TABLE `cmdgrants`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `current_clients`
--
ALTER TABLE `current_clients`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `current_svars`
--
ALTER TABLE `current_svars`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indexes for table `data`
--
ALTER TABLE `data`
  ADD PRIMARY KEY (`data_key`);

--
-- Indexes for table `groups`
--
ALTER TABLE `groups`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `keyword` (`keyword`),
  ADD KEY `level` (`level`);

--
-- Indexes for table `ipaliases`
--
ALTER TABLE `ipaliases`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ipalias` (`ip`,`client_id`),
  ADD KEY `client_id` (`client_id`);

--
-- Indexes for table `nicks`
--
ALTER TABLE `nicks`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`),
  ADD KEY `client_id` (`client_id`);

--
-- Indexes for table `penalties`
--
ALTER TABLE `penalties`
  ADD PRIMARY KEY (`id`),
  ADD KEY `keyword` (`keyword`),
  ADD KEY `type` (`type`),
  ADD KEY `time_expire` (`time_expire`),
  ADD KEY `time_add` (`time_add`),
  ADD KEY `admin_id` (`admin_id`),
  ADD KEY `inactive` (`inactive`),
  ADD KEY `client_id` (`client_id`);

--
-- Indexes for table `player_core`
--
ALTER TABLE `player_core`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `id` (`id`),
  ADD KEY `guid` (`guid`);

--
-- Indexes for table `prestige_log`
--
ALTER TABLE `prestige_log`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `aliases`
--
ALTER TABLE `aliases`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `clients`
--
ALTER TABLE `clients`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `current_clients`
--
ALTER TABLE `current_clients`
  MODIFY `id` int(3) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `current_svars`
--
ALTER TABLE `current_svars`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=46;

--
-- AUTO_INCREMENT for table `ipaliases`
--
ALTER TABLE `ipaliases`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `nicks`
--
ALTER TABLE `nicks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `penalties`
--
ALTER TABLE `penalties`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `player_core`
--
ALTER TABLE `player_core`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `prestige_log`
--
ALTER TABLE `prestige_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
